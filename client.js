// --- 1. KONFIGURACJA FIREBASE ---
const firebaseConfig = {
    apiKey: "AIzaSyBFSlW9_i877sdlTfGHV4XKGeYlbKPAoM0",
    authDomain: "kl-mobile-3536f.firebaseapp.com",
    projectId: "kl-mobile-3536f",
    storageBucket: "kl-mobile-3536f.firebasestorage.app",
    messagingSenderId: "420035668375",
    appId: "1:420035668375:web:712c93f1765729b39bbcd2"
};

if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();

// --- 2. STAN APLIKACJI ---
let currentUser = null;
let myHerd = [];
let completedTasks = [];
let myTreatments = []; 
let currentTaskFilter = 'todo'; 
let currentTypeFilter = 'all';
let currentCalDate = new Date(); 
let currentEditingAnimalId = null;

const DEFAULT_SETTINGS = {
    usg: { enabled: true, start: 45, end: 180, base: 'insem', label: 'Badanie USG' },
    heat: { enabled: true, start: 18, end: 24, base: 'insem', label: 'Powtórka Rui' },
    dry: { enabled: true, start: 40, end: 60, base: 'calving_minus', label: 'Zasuszenie' },
    rovac: { enabled: true, start: 21, end: 28, base: 'calving_minus', label: 'Rovac' },
    kexxtone: { enabled: true, start: 7, end: 14, base: 'calving_minus', label: 'Kexxtone' },
    gestation: 280, 
    customRules: [] 
};
let userSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));

// --- 3. AUTH & START ---
auth.onAuthStateChanged(user => {
    if (user) {
        db.collection('konfiguracja').where('uid', '==', user.uid).get().then(snap => {
            if(!snap.empty && snap.docs[0].data().Rola === 'klient') {
                currentUser = { id: snap.docs[0].id, ...snap.docs[0].data(), uid: user.uid };
                initApp();
            } else { window.location.href = 'index.html'; }
        });
    } else { window.location.href = 'index.html'; }
});

function initApp() {
    const dateEl = document.getElementById('welcomeDate');
    if(dateEl) dateEl.textContent = new Date().toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' });
    
    if(currentUser.numer_gospodarstwa) {
        const farmInput = document.getElementById('cfgFarmNumber');
        if(farmInput) farmInput.value = currentUser.numer_gospodarstwa;
    }

    const today = new Date();
    const lastMonth = new Date();
    lastMonth.setDate(today.getDate() - 30);
    if(document.getElementById('treatmentsDateFrom')) document.getElementById('treatmentsDateFrom').valueAsDate = lastMonth;
    if(document.getElementById('treatmentsDateTo')) document.getElementById('treatmentsDateTo').valueAsDate = today;

    loadSettings().then(() => {
        loadHerd(); 
        loadCompletedTasks();
        renderConfig();
    });
    
    setupNavigation();
    setupModals();
    renderCalendar(new Date());
    if(document.getElementById('insemDate')) document.getElementById('insemDate').valueAsDate = new Date();
}

// --- 4. FUNKCJE POMOCNICZE (Hoisted) ---
function addDays(date, days) { const r = new Date(date); r.setDate(r.getDate() + days); return r; }
function setDateInput(id, deltaDays) {
    const el = document.getElementById(id);
    if(el) { const d = new Date(); d.setDate(d.getDate() + deltaDays); el.valueAsDate = d; }
}
function closeModal(id) { document.getElementById(id).style.display = 'none'; }

// --- 5. ŁADOWANIE DANYCH ---
async function loadSettings() {
    try {
        if(!currentUser || !currentUser.id) return;
        const doc = await db.collection('konfiguracja').doc(currentUser.id).collection('settings').doc('tasks').get();
        if (doc.exists) userSettings = { ...DEFAULT_SETTINGS, ...doc.data() };
    } catch (e) { console.error("Błąd ustawień:", e); }
}

function loadHerd() {
    db.collection('animals').where('ownerUid', '==', currentUser.uid)
      .onSnapshot(snapshot => {
          myHerd = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          updateDashboardStats();
          renderHerdList('all'); 
          populateLists(); 
          generateAndRenderTasks(); 
          renderLactationChart();
          renderCalendar(currentCalDate);
      }, error => console.error("Błąd stada:", error));
}

function loadCompletedTasks() {
    const dateLimit = new Date();
    dateLimit.setDate(dateLimit.getDate() - 60); 
    db.collection('task_logs').where('ownerUid', '==', currentUser.uid).where('completedAt', '>=', dateLimit)
      .onSnapshot(snap => {
          completedTasks = snap.docs.map(doc => ({ logId: doc.id, ...doc.data() }));
          generateAndRenderTasks();
      }, error => console.error("Błąd logów:", error));
}

// --- 6. KARTY LECZENIA (FILTROWANIE + CZYSTA LISTA) ---

function loadTreatments() {
    const container = document.getElementById('treatmentsList');
    const farmNum = currentUser.numer_gospodarstwa;
    const dateFrom = document.getElementById('treatmentsDateFrom').value;
    const dateTo = document.getElementById('treatmentsDateTo').value;

    if(!farmNum) {
        if(container) container.innerHTML = '<div style="text-align:center; padding:20px; color:#999;">Wpisz i ZAPISZ numer gospodarstwa w Opcjach.</div>';
        return;
    }
    if(!dateFrom || !dateTo) { alert("Wybierz zakres dat."); return; }

    const farmNumbers = farmNum.split(',').map(s => s.trim()).filter(s => s.length > 0);
    if(container) container.innerHTML = '<div style="text-align:center; padding:20px; color:#555;">Pobieranie kart...</div>';

    db.collection('archiwumKarty')
      .where('header.nrStada', 'in', farmNumbers)
      .where('header.dataWykonania', '>=', dateFrom)
      .where('header.dataWykonania', '<=', dateTo)
      .limit(50).get().then(snap => {
          myTreatments = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          renderTreatments();
      }).catch(error => {
          console.error(error);
          if(container) container.innerHTML = `<div style="text-align:center; color:red; padding:20px;">Błąd pobierania. Sprawdź konsolę (F12).</div>`;
      });
}

function renderTreatments() {
    const container = document.getElementById('treatmentsList');
    if(!container) return;
    container.innerHTML = '';
    if(myTreatments.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:20px; color:#999;">Brak kart w wybranym okresie.</div>';
        return;
    }
    myTreatments.forEach(card => {
        const h = card.header || {};
        const div = document.createElement('div');
        div.className = 'card';
        div.style.cssText = "padding:15px; border-left:5px solid #2e7d32; margin-bottom:10px;";
        div.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <span style="font-weight:bold;">📅 ${h.dataWykonania || '---'}</span>
                <span style="font-size:14px; color:#2e7d32; font-weight:bold;">${h.nrDokumentu}</span>
            </div>
            <div style="font-size:14px; margin:10px 0;">Lecznica: <strong>${h.nazwaLecznicy || 'Brak nazwy'}</strong></div>
            <button class="btn primary small" style="width:100%; background-color: #34495e;" onclick="openClientPrintWindow('${card.id}')">📄 Zobacz szczegóły (A4)</button>`;
        container.appendChild(div);
    });
}

// --- 7. GENEROWANIE PODGLĄDU A4 ---

function openClientPrintWindow(cardId) {
    const card = myTreatments.find(c => c.id === cardId);
    if (!card) return;
    const header = card.header || {};
    const savedRows = card.table || [];
    const clean = (txt) => (txt || '').replace(/<[^>]*>?/gm, '').replace('📅', '').trim();

    let rowsHTML = '';
    for (let i = 1; i <= 13; i++) {
        let lIdx = (i < 10) ? i - 1 : (i === 10 ? -1 : i - 2);
        let displayLp = (i < 10) ? `${i}.` : (i === 10 ? '' : `${i-10}.`);
        if (i === 10) {
            rowsHTML += `<tr><td colspan="8" style="text-align:left; font-weight:bold; background:#eee; font-size:9pt; padding:4px;">II. Produkty pozostawione</td></tr>`;
            continue;
        }
        const rd = savedRows.find(r => r.logicalIndex === lIdx);
        rowsHTML += `<tr>
            <td style="text-align:center;">${displayLp}</td>
            <td>${rd ? clean(rd.opis) : ''}</td>
            <td style="text-align:center;">${rd ? clean(rd.liczba) : ''}</td>
            <td style="text-align:center;">${rd ? clean(rd.rozpoznanie) : ''}</td>
            <td>${rd ? clean(rd.lek) : ''}</td>
            <td style="text-align:center;">${rd ? clean(rd.seria) : ''}</td>
            <td>${rd ? clean(rd.iloscDawka) : ''}</td>
            <td>${rd ? clean(rd.karencja) : ''}</td>
        </tr>`;
    }

    const win = window.open('', '_blank', 'width=1100,height=800');
    win.document.write(`<html><head><title>Karta Leczenia</title><style>
        body { font-family: sans-serif; padding: 20px; }
        table { width: 100%; border-collapse: collapse; font-size: 9pt; }
        th, td { border: 1px solid #000; padding: 4px; }
        th { background: #EBF5E6; }
        .top { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 20px; font-size: 9pt; }
        @media print { .no-print { display: none; } }
    </style></head><body>
        <div class="no-print"><button onclick="window.print()">DRUKUJ</button></div>
        <h2 style="text-align:center;">KARTA LECZENIA ZWIERZĄT</h2>
        <div class="top">
            <div>Lecznica: <b>${header.nazwaLecznicy}</b><br>Data: ${header.dataWykonania}</div>
            <div>Posiadacz: <b>${header.klient}</b><br>${header.adresKlienta}</div>
            <div>Nr dok: <b>${header.nrDokumentu}</b><br>Nr stada: ${header.nrStada}</div>
        </div>
        <table><thead><tr><th>Lp</th><th>Opis</th><th>Szt.</th><th>Rozpoznanie</th><th>Lek</th><th>Seria</th><th>Ilość</th><th>Karencja</th></tr></thead>
        <tbody>${rowsHTML}</tbody></table>
    </body></html>`);
    win.document.close();
}

// --- 8. STADO I ZADANIA ---

function renderHerdList(type) {
    const list = document.getElementById('herdList'); if(!list) return;
    list.innerHTML = '';
    let filtered = type === 'all' ? myHerd : myHerd.filter(a => a.type === type);
    const search = document.getElementById('herdSearch')?.value.toLowerCase();
    if (search) filtered = filtered.filter(a => a.tag.toLowerCase().includes(search));
    filtered.forEach(a => {
        const div = document.createElement('div'); div.className = 'card'; div.style.padding = '10px';
        div.innerHTML = `<div style="display:flex; justify-content:space-between; align-items:center;"><strong>${a.tag}</strong><span class="badge" style="background:#eee; color:#333;">${a.type}</span></div>`;
        div.onclick = () => openAnimalCard(a.id);
        list.appendChild(div);
    });
}

function generateAndRenderTasks() {
    const today = new Date(); today.setHours(0,0,0,0);
    let tasks = [];
    myHerd.forEach(a => {
        if (!a.lastInsemination) return;
        const insDate = new Date(a.lastInsemination);
        const calvDate = addDays(insDate, userSettings.gestation || 280);
        const diff = Math.floor((calvDate - today) / (86400000));
        if (diff <= 10 && diff >= -15) {
            tasks.push({ id: a.id, tag: a.tag, title: 'Spodziewane Wycielenie', dueDate: calvDate, priority: 'urgent' });
        }
    });
    renderTasksList(tasks);
}

function renderTasksList(tasks) {
    const container = document.getElementById('tasksContainer'); if(!container) return;
    container.innerHTML = tasks.length === 0 ? '<div style="text-align:center; color:#999;">Brak zadań.</div>' : '';
    tasks.forEach(t => {
        const div = document.createElement('div'); div.className = 'task-item urgent';
        div.innerHTML = `<div style="flex:1;"><strong>${t.title}</strong><div class="task-animal-tag" onclick="openAnimalCard('${t.id}')">${t.tag}</div></div>`;
        container.appendChild(div);
    });
}

// --- 9. NAV & CONFIG ---

function setupNavigation() {
    document.querySelectorAll('.nav-item').forEach(btn => btn.addEventListener('click', () => switchSection(btn.dataset.target)));
    document.getElementById('logoutBtn')?.addEventListener('click', () => auth.signOut());
}

function switchSection(id) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    const btn = document.querySelector(`.nav-item[data-target="${id}"]`);
    if(btn) btn.classList.add('active');
}

function saveFarmNumber() {
    const farmNum = document.getElementById('cfgFarmNumber').value.trim();
    if(!farmNum) return alert("Wpisz numer!");
    db.collection('konfiguracja').doc(currentUser.id).update({ numer_gospodarstwa: farmNum })
      .then(() => { currentUser.numer_gospodarstwa = farmNum; alert("Zapisano!"); });
}

// --- 10. MODALE I RESZTA ---
function setupModals() {
    document.getElementById('animalForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const data = { ownerUid: currentUser.uid, tag: document.getElementById('inpTag').value, type: document.getElementById('inpType').value, dob: document.getElementById('inpDob').value, isPregnantConfirmed: false, usgStatus: 'pending' };
        db.collection('animals').add(data).then(() => { alert("Dodano!"); closeModal('animalModal'); });
    });
}
function renderTaskTypeChips() {} 
function renderLactationChart() {}
function renderCalendar() {}
function renderConfig() {}
function populateLists() {}
function updateDashboardStats() {}
function openAnimalCard(id) {}
function toggleEditMode() {}
function saveAnimalChanges() {}
function deleteInsemination() {}
function changeMonth() {}
