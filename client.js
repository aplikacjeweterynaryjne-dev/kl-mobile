// --- KONFIGURACJA FIREBASE ---
// ⚠️ UPEWNIJ SIĘ, ŻE MASZ TU SWOJE DANE KONFIGURACYJNE Z INDEX.HTML
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

// --- STAN APLIKACJI ---
let currentUser = null;
let myHerd = [];
let completedTasks = []; // Pobrane z bazy zadania wykonane
let currentTaskFilter = 'today'; // 'today' | 'month'
let currentTaskSubFilter = 'todo'; // 'todo' | 'done' | 'overdue'

// Ustawienia terminów (Dni)
const SETTINGS = {
    repeatHeat: [18, 21],   // Powtórka rui
    usgCheck: 45,           // USG
    dryOff: 60,             // Zasuszenie (przed porodem)
    rovac: 21,              // Rovac (przed porodem)
    kexxtone: 7,            // Kexxtone (przed porodem)
    gestation: 280,         // Ciąża
    bullSell1: 600,         // Sprzedaż byka I (dni życia ~20m)
    bullSell2: 720          // Sprzedaż byka II (dni życia ~24m)
};

// --- START ---
auth.onAuthStateChanged(user => {
    if (user) {
        db.collection('konfiguracja').where('uid', '==', user.uid).get().then(snap => {
            if(!snap.empty && snap.docs[0].data().Rola === 'klient') {
                currentUser = { ...snap.docs[0].data(), uid: user.uid };
                initApp();
            } else {
                window.location.href = 'index.html';
            }
        });
    } else {
        window.location.href = 'index.html';
    }
});

function initApp() {
    document.getElementById('welcomeDate').textContent = new Date().toLocaleDateString('pl-PL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    loadHerd();
    loadCompletedTasks(); // Ładuje historię wykonanych zadań
    setupNavigation();
    setupModals();
    renderCalendar(new Date()); // Inicjalizacja kalendarza
}

// --- ŁADOWANIE DANYCH ---

function loadHerd() {
    db.collection('animals').where('ownerUid', '==', currentUser.uid)
      .onSnapshot(snapshot => {
          myHerd = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          updateDashboardStats();
          renderHerdList('all'); // Domyślnie pokaż wszystkie
          populateInsemSelect();
          generateAndRenderTasks(); // Przelicz zadania
          renderLactationChart();
      });
}

function loadCompletedTasks() {
    // Pobierz logi zadań wykonanych przez tego użytkownika
    // (W przyszłości warto dodać czyszczenie starych rekordów po stronie serwera)
    db.collection('task_logs')
      .where('ownerUid', '==', currentUser.uid)
      .onSnapshot(snap => {
          const now = new Date();
          completedTasks = [];
          
          snap.forEach(doc => {
              const data = doc.data();
              const doneDate = data.completedAt.toDate();
              const diffDays = (now - doneDate) / (1000 * 60 * 60 * 24);
              
              // Trzymaj w pamięci tylko zadania młodsze niż 14 dni
              if(diffDays <= 14) {
                  completedTasks.push({ logId: doc.id, ...data });
              } else {
                  // Opcjonalnie: Usuń z bazy stare (Clean up)
                  // db.collection('task_logs').doc(doc.id).delete();
              }
          });
          generateAndRenderTasks();
      });
}

// --- LOGIKA ZADAŃ (CORE) ---

function generateAndRenderTasks() {
    const today = new Date();
    today.setHours(0,0,0,0);
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    let allTasks = [];

    myHerd.forEach(animal => {
        // Generuj zadania tylko dla aktywnych zwierząt
        // 1. Logika Rozrodu
        if ((animal.type === 'krowa' || animal.type === 'jalowka') && animal.lastInsemination) {
            const insDate = new Date(animal.lastInsemination);
            const daysSinceInsem = Math.floor((today - insDate) / (1000 * 60 * 60 * 24));
            
            // Jeśli USG było negatywne po dacie inseminacji -> ignoruj tę inseminację
            // (Zakładamy, że user doda nową inseminację, która nadpisze datę)
            if (animal.usgStatus === 'negative') {
                // Nie generuj zadań ciążowych
            } else {
                // A. USG (jeśli jeszcze nie potwierdzono ciąży)
                if (!animal.isPregnantConfirmed) {
                    const usgDate = addDays(insDate, SETTINGS.usgCheck);
                    addTask(allTasks, animal, 'Badanie USG', usgDate, 'urgent', 'usg');
                }
                
                // B. Powtórka (tylko jeśli nie cielna)
                if (!animal.isPregnantConfirmed) {
                    const heatDate = addDays(insDate, 21);
                    addTask(allTasks, animal, 'Obserwacja rui', heatDate, 'warning', 'heat');
                }

                // C. Zadania przedporodowe (tylko jeśli cielna lub domniemana)
                const calvingDate = addDays(insDate, SETTINGS.gestation);
                
                // Zasuszenie (Krowy)
                if (animal.type === 'krowa') {
                    const dryDate = addDays(calvingDate, -SETTINGS.dryOff);
                    addTask(allTasks, animal, 'Zasuszenie', dryDate, 'info', 'dry');
                }

                // Rovac / Kexxtone
                addTask(allTasks, animal, 'Rovac', addDays(calvingDate, -SETTINGS.rovac), 'info', 'rovac');
                addTask(allTasks, animal, 'Kexxtone', addDays(calvingDate, -SETTINGS.kexxtone), 'info', 'kexxtone');
                
                // Wycielenie
                addTask(allTasks, animal, 'Spodziewane wycielenie', calvingDate, 'urgent', 'calving');
            }
        }

        // 2. Logika Byków
        if (animal.type === 'byk' && animal.dob) {
            const dob = new Date(animal.dob);
            const ageDays = Math.floor((today - dob) / (1000 * 60 * 60 * 24));
            
            if (ageDays >= SETTINGS.bullSell1 && ageDays < SETTINGS.bullSell2) {
                addTask(allTasks, animal, 'Sprzedaż byka (I termin)', today, 'warning', 'sell');
            } else if (ageDays >= SETTINGS.bullSell2) {
                addTask(allTasks, animal, 'Sprzedaż byka (PILNE)', today, 'urgent', 'sell');
            }
        }
    });

    renderTasks(allTasks);
}

function addTask(list, animal, title, date, priority, type) {
    // Unikalne ID zadania: TAG + TYP + DATA (string)
    const dateStr = date.toISOString().split('T')[0];
    const taskId = `${animal.id}_${type}_${dateStr}`;
    
    // Sprawdź czy to zadanie jest już w bazie "wykonanych"
    const isDoneLog = completedTasks.find(t => t.taskId === taskId);

    list.push({
        id: taskId,
        animalId: animal.id,
        tag: animal.tag,
        title: title,
        date: date,
        priority: priority,
        type: type,
        isDone: !!isDoneLog,
        doneDate: isDoneLog ? isDoneLog.completedAt.toDate() : null,
        logId: isDoneLog ? isDoneLog.logId : null
    });
}

function renderTasks(tasks) {
    const container = document.getElementById('tasksContainer');
    container.innerHTML = '';

    const today = new Date();
    today.setHours(0,0,0,0);
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    // 1. Filtrowanie Czasowe
    let filtered = tasks.filter(t => {
        if (currentTaskFilter === 'today') {
            return t.date <= today; // Zaległe i dzisiejsze
        } else {
            return t.date <= endOfMonth; // Do końca miesiąca
        }
    });

    // 2. Filtrowanie Statusu
    if (currentTaskSubFilter === 'done') {
        filtered = filtered.filter(t => t.isDone);
    } else if (currentTaskSubFilter === 'todo') {
        filtered = filtered.filter(t => !t.isDone && t.date >= today); // Przyszłe i dzisiejsze niewykonane
    } else if (currentTaskSubFilter === 'overdue') {
        filtered = filtered.filter(t => !t.isDone && t.date < today); // Niewykonane i data minęła
    }

    // Sortowanie
    filtered.sort((a,b) => a.date - b.date);

    if (filtered.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:20px; color:#999;">Brak zadań w tej kategorii.</div>';
        return;
    }

    filtered.forEach(t => {
        const div = document.createElement('div');
        div.className = `task-item ${t.priority} ${t.isDone ? 'done' : ''}`;
        
        // Data
        const d = t.date.toLocaleDateString('pl-PL');
        const diff = Math.ceil((t.date - today) / (1000 * 60 * 60 * 24));
        let timeLabel = diff === 0 ? 'DZIŚ' : (diff < 0 ? `${Math.abs(diff)} dni po` : `${diff} dni`);
        if(t.isDone) timeLabel = `Wykonano: ${t.doneDate.toLocaleDateString()}`;

        div.innerHTML = `
            <div style="flex:1;">
                <div style="font-size:14px; font-weight:bold;">${t.title}</div>
                <div style="font-size:12px; color:#555;">
                    Termin: ${d} <span style="color:${diff<0 && !t.isDone ? 'red' : '#777'}">(${timeLabel})</span>
                </div>
                <div class="task-animal-tag" onclick="openAnimalCard('${t.animalId}')">${t.tag}</div>
            </div>
            <div>
                ${t.isDone 
                    ? `<button class="btn" style="padding:5px 10px; font-size:12px; background:#ddd;" onclick="undoTask('${t.logId}')">Cofnij</button>`
                    : `<input type="checkbox" style="transform:scale(1.5); cursor:pointer;" onclick="initiateTaskCompletion('${t.id}', '${t.type}', '${t.animalId}')">`
                }
            </div>
        `;
        container.appendChild(div);
    });
}

// --- ZARZĄDZANIE WYKONANIEM ZADAŃ ---

let pendingTask = null; // Przechowuje dane zadania do potwierdzenia

function initiateTaskCompletion(taskId, type, animalId) {
    pendingTask = { taskId, type, animalId };
    const modal = document.getElementById('taskConfirmModal');
    const usgOpts = document.getElementById('usgResultOptions');
    const stdBtns = document.getElementById('standardConfirmBtns');
    const txt = document.getElementById('taskConfirmText');

    if (type === 'usg') {
        usgOpts.classList.remove('hidden');
        stdBtns.classList.add('hidden');
        txt.textContent = "Wprowadź wynik badania USG:";
    } else {
        usgOpts.classList.add('hidden');
        stdBtns.classList.remove('hidden');
        txt.textContent = "Czy na pewno oznaczyć zadanie jako wykonane?";
    }
    
    modal.style.display = 'flex';
}

function confirmTaskStandard() {
    if(!pendingTask) return;
    saveTaskLog(pendingTask.taskId, pendingTask.type, pendingTask.animalId, null);
    closeModal('taskConfirmModal');
}

function confirmTaskUSG(isPregnant) {
    if(!pendingTask) return;
    
    // 1. Zapisz log zadania
    saveTaskLog(pendingTask.taskId, pendingTask.type, pendingTask.animalId, isPregnant ? 'Pozytywny' : 'Negatywny');

    // 2. Zaktualizuj status zwierzęcia w bazie
    db.collection('animals').doc(pendingTask.animalId).update({
        isPregnantConfirmed: isPregnant,
        usgStatus: isPregnant ? 'positive' : 'negative',
        // Jeśli negatywny, to "resetujemy" cykl (ale nie kasujemy daty inseminacji, tylko flagujemy że nieudana)
    }).then(() => {
        alert(isPregnant ? "Zapisano: CIELNA ✅" : "Zapisano: NIECIELNA ❌");
    });

    closeModal('taskConfirmModal');
}

function saveTaskLog(taskId, type, animalId, result) {
    db.collection('task_logs').add({
        ownerUid: currentUser.uid,
        taskId: taskId,
        taskType: type,
        animalId: animalId,
        result: result,
        completedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
}

function undoTask(logId) {
    if(confirm("Czy cofnąć status wykonania?")) {
        db.collection('task_logs').doc(logId).delete();
    }
}

// --- INSEMINACJA I FORMULARZE ---

function populateInsemSelect() {
    const sel = document.getElementById('insemTag');
    sel.innerHTML = '';
    // Pokaż tylko samice
    myHerd.filter(a => a.type !== 'byk').forEach(a => {
        const opt = document.createElement('option');
        opt.value = a.id;
        opt.textContent = `${a.tag} (${a.type})`;
        sel.appendChild(opt);
    });
}

document.getElementById('insemForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const animalId = document.getElementById('insemTag').value;
    const date = document.getElementById('insemDate').value;
    const bull = document.getElementById('insemBull').value;
    const note = document.getElementById('insemNote').value;

    const animal = myHerd.find(a => a.id === animalId);
    if (!animal) return;

    // Aktualizacja zwierzęcia
    // 1. Dodaj do historii (tablica obiektów)
    const newHistoryEntry = {
        date: date,
        bull: bull,
        note: note,
        addedAt: new Date().toISOString()
    };

    const history = animal.historyInsemination || [];
    history.push(newHistoryEntry);

    db.collection('animals').doc(animalId).update({
        lastInsemination: date,
        semen: bull,
        historyInsemination: history,
        isPregnantConfirmed: false, // Reset statusu ciąży przy nowym kryciu
        usgStatus: 'pending'        // Oczekiwanie na badanie
    }).then(() => {
        alert("Zapisano inseminację!");
        document.getElementById('insemForm').reset();
        // Przejdź do dashboardu
        switchSection('section-dashboard');
    });
});

// --- STATYSTYKI I WYKRESY ---

function updateDashboardStats() {
    document.getElementById('cntCows').textContent = myHerd.filter(a => a.type === 'krowa').length;
    document.getElementById('cntHeifers').textContent = myHerd.filter(a => a.type === 'jalowka').length;
    document.getElementById('cntBulls').textContent = myHerd.filter(a => a.type === 'byk').length;
}

function renderLactationChart() {
    const ctx = document.getElementById('lactationChart');
    
    // Obliczanie kubełków (Buckets)
    const buckets = [0, 0, 0, 0, 0, 0]; // 0-2m, 2-4m, 4-6m, 6-8m, 8-10m, >10m
    const today = new Date();

    myHerd.forEach(a => {
        if (a.type === 'krowa' && a.lastCalving) {
            const calvingDate = new Date(a.lastCalving);
            const months = (today - calvingDate) / (1000 * 60 * 60 * 24 * 30); // ~miesiące
            
            if (months <= 2) buckets[0]++;
            else if (months <= 4) buckets[1]++;
            else if (months <= 6) buckets[2]++;
            else if (months <= 8) buckets[3]++;
            else if (months <= 10) buckets[4]++;
            else buckets[5]++; // Powyżej roku/10m
        }
    });

    if (window.myChart) window.myChart.destroy();
    window.myChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['0-2m', '2-4m', '4-6m', '6-8m', '8-10m', '>10m'],
            datasets: [{
                label: 'Sztuk',
                data: buckets,
                backgroundColor: '#2e7d32',
                borderRadius: 5
            }]
        },
        options: {
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
        }
    });
}

// --- KALENDARZ ---

let currentCalDate = new Date();

function changeMonth(delta) {
    currentCalDate.setMonth(currentCalDate.getMonth() + delta);
    renderCalendar(currentCalDate);
}

function renderCalendar(date) {
    const container = document.getElementById('calendarDays');
    const title = document.getElementById('calTitle');
    container.innerHTML = '';
    
    const year = date.getFullYear();
    const month = date.getMonth();
    
    title.textContent = date.toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' });

    const firstDay = new Date(year, month, 1).getDay(); // 0=Nd, 1=Pn
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    // Korekta żeby Pn był pierwszy (1)
    let startOffset = firstDay === 0 ? 6 : firstDay - 1;

    // Puste pola
    for (let i = 0; i < startOffset; i++) {
        container.appendChild(document.createElement('div'));
    }

    // Dni
    for (let d = 1; d <= daysInMonth; d++) {
        const dayDiv = document.createElement('div');
        dayDiv.className = 'cal-day';
        dayDiv.textContent = d;
        
        // Sprawdź czy są wycielenia tego dnia
        const checkDate = new Date(year, month, d);
        const events = getEventsForDate(checkDate);

        if (events.length > 0) {
            dayDiv.classList.add('has-event');
            const dot = document.createElement('div');
            dot.className = 'cal-dot';
            dayDiv.appendChild(dot);
            
            // Kliknięcie
            dayDiv.onclick = () => showCalendarEvents(checkDate, events);
        }

        // Dziś
        const today = new Date();
        if (d === today.getDate() && month === today.getMonth() && year === today.getFullYear()) {
            dayDiv.classList.add('today');
        }

        container.appendChild(dayDiv);
    }
}

function getEventsForDate(date) {
    // Szukamy wycieleń w tym dniu (+/- 1 dzień marginesu na strefy czasowe)
    const target = date.getTime();
    const margin = 1000 * 60 * 60 * 24; 

    return myHerd.filter(a => {
        if (!a.lastInsemination) return false;
        // Tylko jeśli nie ma negatywnego USG
        if (a.usgStatus === 'negative') return false;

        const estCalving = addDays(new Date(a.lastInsemination), SETTINGS.gestation);
        const time = estCalving.getTime();
        
        // Sprawdź czy to ten sam dzień (z grubsza)
        return Math.abs(time - target) < margin;
    });
}

function showCalendarEvents(date, animals) {
    const list = document.getElementById('calEventsList');
    document.getElementById('calSelectedDateTitle').textContent = `Wycielenia: ${date.toLocaleDateString()}`;
    list.innerHTML = '';

    animals.forEach(a => {
        const div = document.createElement('div');
        div.className = 'card';
        div.innerHTML = `<strong>🐮 ${a.tag}</strong> - Spodziewane wycielenie`;
        div.onclick = () => openAnimalCard(a.id);
        list.appendChild(div);
    });
}


// --- MODAL KARTY ZWIERZĘCIA ---

function openAnimalCard(id) {
    const animal = myHerd.find(a => a.id === id);
    if (!animal) return;

    document.getElementById('cardTag').textContent = animal.tag;
    document.getElementById('cardDob').textContent = animal.dob;
    
    // Wiek
    const today = new Date();
    const dob = new Date(animal.dob);
    const months = Math.floor((today - dob) / (1000 * 60 * 60 * 24 * 30));
    document.getElementById('cardAge').textContent = `${months} mies.`;
    
    document.getElementById('cardType').textContent = animal.type;
    document.getElementById('cardLoc').textContent = animal.location || '-';
    
    // Statusy
    const badges = document.getElementById('cardBadges');
    badges.innerHTML = '';
    
    // Logika Statusu Ciąży
    let pregStatus = 'Brak danych';
    let badgeClass = 'bg-unknown';

    if (animal.type === 'krowa' || animal.type === 'jalowka') {
        if (animal.isPregnantConfirmed) {
            pregStatus = 'CIELNA ✅';
            badgeClass = 'bg-pregnant';
        } else if (animal.usgStatus === 'negative') {
            pregStatus = 'NIECIELNA (Pusta) ❌';
            badgeClass = 'bg-open';
        } else if (animal.lastInsemination) {
            pregStatus = 'Do badania (?)';
            badgeClass = 'bg-unknown';
        }

        // Świeżo wycielona?
        if (animal.lastCalving) {
            const calvDate = new Date(animal.lastCalving);
            const daysSince = Math.floor((today - calvDate) / (1000 * 60 * 60 * 24));
            document.getElementById('cardDim').textContent = daysSince + ' dni';
            
            if (daysSince < 60) {
                 const b = document.createElement('span');
                 b.className = 'badge bg-fresh';
                 b.textContent = 'Świeża';
                 b.style.marginRight = '5px';
                 badges.appendChild(b);
            }
        } else {
            document.getElementById('cardDim').textContent = '-';
        }
    }
    
    document.getElementById('cardPregStatus').textContent = pregStatus;
    const bMain = document.createElement('span');
    bMain.className = `badge ${badgeClass}`;
    bMain.textContent = pregStatus;
    badges.appendChild(bMain);

    document.getElementById('cardLastCalving').textContent = animal.lastCalving || '-';
    document.getElementById('cardLastInsem').textContent = animal.lastInsemination || '-';
    document.getElementById('cardSemen').textContent = animal.semen || '-';

    // Historia
    const histDiv = document.getElementById('cardHistory');
    histDiv.innerHTML = '';
    if (animal.historyInsemination) {
        animal.historyInsemination.reverse().forEach(h => {
            const p = document.createElement('p');
            p.style.borderBottom = '1px solid #eee';
            p.innerHTML = `💉 <b>${h.date}</b> (${h.bull}) - ${h.note || ''}`;
            histDiv.appendChild(p);
        });
    } else {
        histDiv.textContent = 'Brak wpisów w historii.';
    }

    // Usuwanie
    document.getElementById('btnDeleteAnimal').onclick = () => {
        if (confirm("Czy na pewno usunąć zwierzę i całą jego historię?")) {
            db.collection('animals').doc(id).delete();
            closeModal('animalCardModal');
        }
    };

    document.getElementById('animalCardModal').style.display = 'flex';
}

// --- HELPERY I NAV ---

function switchTaskTime(mode) {
    currentTaskFilter = mode;
    document.querySelectorAll('.task-tab').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
    generateAndRenderTasks();
}

function filterTasks(mode) {
    currentTaskSubFilter = mode;
    document.querySelectorAll('.sub-tab').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
    generateAndRenderTasks();
}

function filterHerd(type) {
    switchSection('section-herd');
    renderHerdList(type);
}

function renderHerdList(filterType) {
    const list = document.getElementById('herdList');
    list.innerHTML = '';
    
    let filtered = myHerd;
    if (filterType !== 'all') {
        filtered = myHerd.filter(a => a.type === filterType);
        document.getElementById('herdTitle').textContent = 
            filterType === 'krowa' ? 'Lista Krów' : (filterType === 'byk' ? 'Lista Byków' : 'Lista Jałówek');
    } else {
        document.getElementById('herdTitle').textContent = 'Całe Stado';
    }

    // Szukajka
    const searchVal = document.getElementById('herdSearch').value.toLowerCase();
    if(searchVal) {
        filtered = filtered.filter(a => a.tag.toLowerCase().includes(searchVal));
    }

    filtered.forEach(a => {
        const div = document.createElement('div');
        div.className = 'card';
        div.style.padding = '10px';
        div.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <strong style="font-size:16px; color:#2e7d32;">${a.tag}</strong>
                <span class="badge" style="background:#ddd; color:#333;">${a.type}</span>
            </div>
            <div style="font-size:12px; color:#555; margin-top:5px;">
                Ur: ${a.dob} | ${a.location || ''}
            </div>
        `;
        div.onclick = () => openAnimalCard(a.id);
        list.appendChild(div);
    });
}
document.getElementById('herdSearch').addEventListener('input', () => renderHerdList('all'));


function setupNavigation() {
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', () => {
            switchSection(btn.dataset.target);
            document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });
    document.getElementById('logoutBtn').addEventListener('click', () => {
        auth.signOut().then(() => window.location.href = 'index.html');
    });
}

function switchSection(id) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

function setupModals() {
    // Te funkcje są wywoływane inline w HTML, tutaj tylko helpery
    window.closeModal = (id) => document.getElementById(id).style.display = 'none';
    window.openAnimalModal = () => document.getElementById('animalModal').style.display = 'flex';
    
    // Logika formularza dodawania
    const typeSel = document.getElementById('inpType');
    typeSel.addEventListener('change', () => {
        if(typeSel.value === 'krowa') document.getElementById('cowFields').classList.remove('hidden');
        else document.getElementById('cowFields').classList.add('hidden');
    });

    document.getElementById('animalForm').addEventListener('submit', (e) => {
        e.preventDefault();
        db.collection('animals').add({
            ownerUid: currentUser.uid,
            clinicId: currentUser['ID lecznicy'] || '',
            tag: document.getElementById('inpTag').value,
            type: document.getElementById('inpType').value,
            dob: document.getElementById('inpDob').value,
            location: document.getElementById('inpLoc').value,
            lastCalving: document.getElementById('inpLastCalving').value || null,
            lastInsemination: document.getElementById('inpLastInsem').value || null,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }).then(() => {
            alert("Dodano zwierzę!");
            document.getElementById('animalForm').reset();
            closeModal('animalModal');
        });
    });
}

function goToInsem() {
    switchSection('section-insem');
    // Aktywuj ikonę w menu
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelector('[data-target="section-insem"]').classList.add('active');
}

function addDays(date, days) {
    const r = new Date(date);
    r.setDate(r.getDate() + days);
    return r;
}
