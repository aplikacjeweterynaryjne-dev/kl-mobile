// --- KONFIGURACJA FIREBASE ---
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
let completedTasks = [];
let currentTaskFilter = 'todo'; // 'todo' | 'month' | 'overdue' | 'done'
let currentTypeFilter = 'all';  // np. 'usg', 'dry'

// Ustawienia Domyślne
const DEFAULT_SETTINGS = {
    usg: { enabled: true, start: 45, end: 180, base: 'insem', label: 'Badanie USG' },
    heat: { enabled: true, start: 18, end: 24, base: 'insem', label: 'Powtórka Rui' },
    dry: { enabled: true, start: 40, end: 60, base: 'calving_minus', label: 'Zasuszenie' },
    rovac: { enabled: true, start: 21, end: 28, base: 'calving_minus', label: 'Rovac' },
    kexxtone: { enabled: true, start: 7, end: 14, base: 'calving_minus', label: 'Kexxtone' },
    gestation: 280, // Długość ciąży (stała)
    customRules: [] // Tablica na własne reguły użytkownika
};

let userSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)); // Kopia robocza

// --- AUTH ---
auth.onAuthStateChanged(user => {
    if (user) {
        db.collection('konfiguracja').where('uid', '==', user.uid).get().then(snap => {
            if(!snap.empty && snap.docs[0].data().Rola === 'klient') {
                currentUser = { ...snap.docs[0].data(), uid: user.uid };
                initApp();
            } else { window.location.href = 'index.html'; }
        });
    } else { window.location.href = 'index.html'; }
});

function initApp() {
    document.getElementById('welcomeDate').textContent = new Date().toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' });
    
    loadSettings().then(() => {
        loadHerd();
        loadCompletedTasks();
        renderConfig();
    });
    
    setupNavigation();
    setupModals();
    renderCalendar(new Date());
    
    // Domyślna data w inseminacji to dziś
    document.getElementById('insemDate').valueAsDate = new Date();
}

// --- ŁADOWANIE DANYCH ---

async function loadSettings() {
    try {
        const doc = await db.collection('konfiguracja').doc(currentUser.id).collection('settings').doc('tasks').get();
        if (doc.exists) {
            const saved = doc.data();
            userSettings = { ...DEFAULT_SETTINGS, ...saved };
        }
    } catch (e) { console.error("Błąd ustawień", e); }
}

function loadHerd() {
    db.collection('animals').where('ownerUid', '==', currentUser.uid)
      .onSnapshot(snapshot => {
          myHerd = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          updateDashboardStats();
          renderHerdList('all');
          populateInsemSelect();
          generateAndRenderTasks();
          renderLactationChart();
          // Odśwież kalendarz po załadowaniu stada
          renderCalendar(currentCalDate);
      });
}

function loadCompletedTasks() {
    const dateLimit = new Date();
    dateLimit.setDate(dateLimit.getDate() - 30);
    
    db.collection('task_logs')
      .where('ownerUid', '==', currentUser.uid)
      .where('completedAt', '>=', dateLimit)
      .onSnapshot(snap => {
          completedTasks = [];
          const now = new Date();
          snap.forEach(doc => {
              const data = doc.data();
              const doneDate = data.completedAt.toDate();
              const diffDays = (now - doneDate) / (1000 * 60 * 60 * 24);
              
              if(diffDays <= 14) {
                  completedTasks.push({ logId: doc.id, ...data });
              }
          });
          generateAndRenderTasks();
      });
}

// --- LOGIKA ZADAŃ (SILNIK) ---

function generateAndRenderTasks() {
    const today = new Date();
    today.setHours(0,0,0,0);

    let generatedTasks = [];

    myHerd.forEach(animal => {
        if (animal.type !== 'krowa' && animal.type !== 'jalowka') return;
        if (!animal.lastInsemination) return;
        if (animal.usgStatus === 'negative') return;

        const insDate = new Date(animal.lastInsemination);
        const gestDays = userSettings.gestation || 280;
        const calvingDate = addDays(insDate, gestDays);
        const daysSinceInsem = Math.floor((today - insDate) / (1000 * 60 * 60 * 24));

        // Zadania oparte na inseminacji
        checkRuleAndAddTask(generatedTasks, animal, userSettings.usg, daysSinceInsem, insDate, 'usg', calvingDate);
        
        if (!animal.isPregnantConfirmed) {
            checkRuleAndAddTask(generatedTasks, animal, userSettings.heat, daysSinceInsem, insDate, 'heat', calvingDate);
        }

        // Zadania oparte na wycieleniu (dni do porodu)
        const daysToCalving = Math.floor((calvingDate - today) / (1000 * 60 * 60 * 24));
        
        if (animal.type === 'krowa') {
             checkRuleAndAddTask(generatedTasks, animal, userSettings.dry, daysToCalving, calvingDate, 'dry', calvingDate, true);
        }
        checkRuleAndAddTask(generatedTasks, animal, userSettings.rovac, daysToCalving, calvingDate, 'rovac', calvingDate, true);
        checkRuleAndAddTask(generatedTasks, animal, userSettings.kexxtone, daysToCalving, calvingDate, 'kexxtone', calvingDate, true);

        // Custom Rules
        userSettings.customRules.forEach((rule, idx) => {
            if(rule.base === 'insem') {
                checkRuleAndAddTask(generatedTasks, animal, rule, daysSinceInsem, insDate, `custom_${idx}`, calvingDate);
            } else {
                checkRuleAndAddTask(generatedTasks, animal, rule, daysToCalving, calvingDate, `custom_${idx}`, calvingDate, true);
            }
        });
        
        // Samo Wycielenie
        if (daysToCalving <= 10 && daysToCalving >= -10) {
            addTask(generatedTasks, animal, 'Spodziewane Wycielenie', calvingDate, calvingDate, 'urgent', 'calving', insDate, calvingDate);
        }
    });

    renderTasks(generatedTasks);
}

function checkRuleAndAddTask(list, animal, rule, daysCounter, refDate, type, calvDate, isReverse = false) {
    if (!rule || !rule.enabled) return;
    
    let isActive = false;
    let isOverdue = false;
    let dueDate = null;

    if (isReverse) {
        if (daysCounter <= rule.start && daysCounter >= rule.end) isActive = true;
        if (daysCounter < rule.end) isOverdue = true;
        dueDate = addDays(calvDate, -rule.end);
    } else {
        if (daysCounter >= rule.start && daysCounter <= rule.end) isActive = true;
        if (daysCounter > rule.end) isOverdue = true;
        dueDate = addDays(refDate, rule.end);
    }

    if (isActive) {
        addTask(list, animal, rule.label, dueDate, new Date(), 'warning', type, refDate, calvDate);
    } else if (isOverdue) {
        addTask(list, animal, rule.label, dueDate, new Date(), 'urgent', type, refDate, calvDate);
    }
}

function addTask(list, animal, title, dueDate, sortDate, priority, type, insemDate, calvDate) {
    const dateStr = dueDate.toISOString().split('T')[0];
    const taskId = `${animal.id}_${type}_${dateStr}`;
    
    const doneLog = completedTasks.find(t => t.taskId === taskId);

    list.push({
        id: taskId,
        animalId: animal.id,
        tag: animal.tag,
        title: title,
        dueDate: dueDate,
        sortDate: sortDate,
        priority: priority,
        type: type,
        isDone: !!doneLog,
        doneDate: doneLog ? doneLog.completedAt.toDate() : null,
        logId: doneLog ? doneLog.logId : null,
        insemDate: insemDate,
        calvDate: calvDate
    });
}

function renderTasks(tasks) {
    const container = document.getElementById('tasksContainer');
    container.innerHTML = '';

    const today = new Date();
    today.setHours(0,0,0,0);
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    let filtered = tasks;

    if (currentTaskFilter === 'done') {
        filtered = tasks.filter(t => t.isDone);
    } else if (currentTaskFilter === 'todo') {
        filtered = tasks.filter(t => !t.isDone && t.priority !== 'urgent');
    } else if (currentTaskFilter === 'overdue') {
        filtered = tasks.filter(t => !t.isDone && t.priority === 'urgent');
    } else if (currentTaskFilter === 'month') {
        filtered = tasks.filter(t => !t.isDone && t.dueDate <= endOfMonth);
    }

    if (currentTypeFilter !== 'all') {
        filtered = filtered.filter(t => t.type === currentTypeFilter);
    }

    filtered.sort((a,b) => a.dueDate - b.dueDate);

    // Renderowanie Chipsów (tu poprawka z Custom Name)
    renderTaskTypeChips(tasks);

    if (filtered.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:20px; color:#999;">Brak zadań.</div>';
        return;
    }

    filtered.forEach(t => {
        const div = document.createElement('div');
        div.className = `task-item ${t.priority} ${t.isDone ? 'done' : ''}`;
        
        const dueStr = t.dueDate.toLocaleDateString('pl-PL');
        const insemStr = t.insemDate ? t.insemDate.toLocaleDateString('pl-PL') : '-';
        const calvStr = t.calvDate ? t.calvDate.toLocaleDateString('pl-PL') : '-';

        div.innerHTML = `
            <div style="flex:1;">
                <div style="font-size:15px; font-weight:bold; color:#333;">${t.title}</div>
                
                <div class="task-dates">
                    <span>📅 Termin: <b style="color:${t.priority==='urgent' && !t.isDone ? 'red':'#333'}">${dueStr}</b></span>
                    <span>💉 Zac: ${insemStr}</span>
                    <span>👶 Wyc: ${calvStr}</span>
                </div>

                <div class="task-animal-tag" onclick="openAnimalCard('${t.animalId}')">${t.tag}</div>
            </div>
            
            <div style="margin-left:10px; display:flex; align-items:center;">
                ${t.isDone 
                    ? `<button class="btn" style="padding:5px 10px; font-size:12px; background:#ddd;" onclick="undoTask('${t.logId}')">Cofnij</button>`
                    : `<input type="checkbox" style="transform:scale(1.5); cursor:pointer;" onclick="initiateTaskCompletion('${t.id}', '${t.type}', '${t.animalId}')">`
                }
            </div>
        `;
        container.appendChild(div);
    });
}

// POPRAWKA: Prawidłowe nazwy w filtrach
function renderTaskTypeChips(allTasks) {
    const container = document.getElementById('taskTypeChips');
    container.innerHTML = '';
    
    const types = new Set(['all']);
    allTasks.forEach(t => { if(!t.isDone) types.add(t.type); });

    const labels = {
        'all': 'Wszystkie', 'usg': 'USG', 'heat': 'Ruja', 
        'dry': 'Zasuszenie', 'rovac': 'Rovac', 'kexxtone': 'Kexxtone', 'calving': 'Wycielenia'
    };

    types.forEach(type => {
        let label = labels[type];

        // Jeśli to zadanie własne (custom), pobierz nazwę z ustawień
        if (!label && type.startsWith('custom_')) {
            const idx = parseInt(type.split('_')[1]);
            if (userSettings.customRules[idx]) {
                label = userSettings.customRules[idx].label;
            } else {
                label = 'Własne';
            }
        }
        if (!label) label = type;

        const btn = document.createElement('button');
        btn.className = `filter-chip ${currentTypeFilter === type ? 'active' : ''}`;
        btn.textContent = label;
        btn.onclick = () => { currentTypeFilter = type; generateAndRenderTasks(); };
        container.appendChild(btn);
    });
}

// --- STATUSY I CONFIRM ---

let pendingTask = null;

function initiateTaskCompletion(taskId, type, animalId) {
    pendingTask = { taskId, type, animalId };
    const modal = document.getElementById('taskConfirmModal');
    const txt = document.getElementById('taskConfirmText');
    
    if (type === 'usg') {
        document.getElementById('usgResultOptions').classList.remove('hidden');
        document.getElementById('standardConfirmBtns').classList.add('hidden');
        txt.textContent = "";
    } else {
        document.getElementById('usgResultOptions').classList.add('hidden');
        document.getElementById('standardConfirmBtns').classList.remove('hidden');
        txt.textContent = "Czy potwierdzasz wykonanie zadania?";
    }
    modal.style.display = 'flex';
}

function confirmTaskStandard() {
    if(!pendingTask) return;
    saveTaskLog(pendingTask, null);
    closeModal('taskConfirmModal');
}

function confirmTaskUSG(isPregnant) {
    if(!pendingTask) return;
    saveTaskLog(pendingTask, isPregnant ? 'Pozytywny' : 'Negatywny');
    db.collection('animals').doc(pendingTask.animalId).update({
        isPregnantConfirmed: isPregnant,
        usgStatus: isPregnant ? 'positive' : 'negative'
    });
    closeModal('taskConfirmModal');
}

function saveTaskLog(taskData, result) {
    db.collection('task_logs').add({
        ownerUid: currentUser.uid,
        taskId: taskData.taskId,
        taskType: taskData.type,
        animalId: taskData.animalId,
        result: result,
        completedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
}

function undoTask(logId) {
    if(confirm("Cofnąć status wykonania?")) {
        db.collection('task_logs').doc(logId).delete();
    }
}

// --- INSEMINACJA ---

function openInsemModal() { document.getElementById('insemModal').style.display = 'flex'; }

function populateInsemSelect() {
    const sel = document.getElementById('insemTag');
    sel.innerHTML = '';
    myHerd.filter(a => a.type !== 'byk').sort((a,b) => a.tag.localeCompare(b.tag)).forEach(a => {
        const opt = document.createElement('option');
        opt.value = a.id;
        opt.textContent = `${a.tag}`;
        sel.appendChild(opt);
    });
}

document.getElementById('insemForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const id = document.getElementById('insemTag').value;
    const date = document.getElementById('insemDate').value;
    const bull = document.getElementById('insemBull').value;
    const note = document.getElementById('insemNote').value;

    const animal = myHerd.find(a => a.id === id);
    if(!animal) return;

    const newHistory = { date, bull, note, added: new Date().toISOString() };
    const history = animal.historyInsemination || [];
    history.push(newHistory);

    db.collection('animals').doc(id).update({
        lastInsemination: date, semen: bull, historyInsemination: history,
        isPregnantConfirmed: false, usgStatus: 'pending'
    }).then(() => {
        alert("Zapisano!");
        document.getElementById('insemForm').reset();
        document.getElementById('insemDate').valueAsDate = new Date();
        closeModal('insemModal');
    });
});

// --- STATYSTYKI I LISTY ---

function filterHerd(type) {
    switchSection('section-herd');
    renderHerdList(type);
}

function renderHerdList(typeFilter) {
    const list = document.getElementById('herdList');
    list.innerHTML = '';
    
    let filtered = myHerd;
    if (typeFilter !== 'all') filtered = myHerd.filter(a => a.type === typeFilter);

    const search = document.getElementById('herdSearch').value.toLowerCase();
    if (search) filtered = filtered.filter(a => a.tag.toLowerCase().includes(search));

    document.getElementById('herdTitle').textContent = typeFilter === 'all' ? 'Pełna Lista' : `Lista: ${typeFilter.toUpperCase()}`;

    filtered.forEach(a => {
        const div = document.createElement('div');
        div.className = 'card';
        div.style.padding = '10px';
        div.innerHTML = `
            <div style="display:flex; justify-content:space-between;">
                <strong style="color:#2e7d32; font-size:16px;">${a.tag}</strong>
                <span class="badge" style="background:#eee; color:#333;">${a.type}</span>
            </div>
            <div style="font-size:12px; color:#555;">Ur: ${a.dob}</div>
        `;
        div.onclick = () => openAnimalCard(a.id);
        list.appendChild(div);
    });
}
document.getElementById('herdSearch').addEventListener('input', () => renderHerdList('all'));

function renderLactationChart() {
    const ctx = document.getElementById('lactationChart');
    const buckets = [0, 0, 0, 0, 0, 0, 0];
    const bucketAnimals = [[], [], [], [], [], [], []];
    const today = new Date();

    myHerd.forEach(a => {
        if (a.type === 'krowa' && a.lastCalving) {
            const calvDate = new Date(a.lastCalving);
            const months = (today - calvDate) / (1000 * 60 * 60 * 24 * 30.4);
            
            let idx = 0;
            if (months <= 2) idx = 0;
            else if (months <= 4) idx = 1;
            else if (months <= 6) idx = 2;
            else if (months <= 8) idx = 3;
            else if (months <= 10) idx = 4;
            else if (months <= 12) idx = 5;
            else idx = 6;

            buckets[idx]++;
            bucketAnimals[idx].push(a);
        }
    });

    if (window.myChart) window.myChart.destroy();
    window.myChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['0-2m', '2-4m', '4-6m', '6-8m', '8-10m', '10-12m', '>12m'],
            datasets: [{
                label: 'Sztuk', data: buckets, backgroundColor: '#2e7d32', borderRadius: 4
            }]
        },
        options: {
            plugins: { legend: { display: false } },
            onClick: (evt, activeEls) => {
                if (activeEls.length > 0) {
                    const idx = activeEls[0].index;
                    showListModal(`Laktacja: ${window.myChart.data.labels[idx]}`, bucketAnimals[idx]);
                }
            }
        }
    });
}

// --- KALENDARZ (POPRAWIONA LOGIKA) ---

let currentCalDate = new Date();

function changeMonth(delta) {
    currentCalDate.setMonth(currentCalDate.getMonth() + delta);
    renderCalendar(currentCalDate);
}

// Funkcja pomocnicza do renderowania listy pod kalendarzem
function renderCalendarEventsList(events, title) {
    const list = document.getElementById('calEventsList');
    list.innerHTML = '';
    document.getElementById('calSelectedDateTitle').textContent = title;
    
    if (events.length === 0) {
        list.innerHTML = '<p style="color:#999; text-align:center;">Brak wydarzeń</p>';
        return;
    }

    events.forEach(e => {
        const el = document.createElement('div');
        el.className = 'card';
        el.style.padding = '10px';
        const dateStr = e.date.toLocaleDateString('pl-PL');
        el.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <span>🐮 <b>${e.animal.tag}</b></span>
                <span style="font-size:11px; color:#555;">${dateStr}</span>
            </div>
            <div style="font-size:11px; color:#2e7d32;">Spodziewane wycielenie</div>
        `;
        el.onclick = () => openAnimalCard(e.animal.id);
        list.appendChild(el);
    });
}

function renderCalendar(date) {
    const container = document.getElementById('calendarDays');
    container.innerHTML = '';
    
    const year = date.getFullYear();
    const month = date.getMonth();
    
    const titleEl = document.getElementById('calTitle');
    titleEl.textContent = date.toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' });
    
    // Oblicz wydarzenia dla całego miesiąca
    let monthEvents = [];
    myHerd.forEach(a => {
        if (!a.lastInsemination || a.usgStatus === 'negative') return;
        const est = addDays(new Date(a.lastInsemination), userSettings.gestation || 280);
        if (est.getFullYear() === year && est.getMonth() === month) {
            monthEvents.push({ animal: a, date: est });
        }
    });

    // Sortuj wydarzenia po dacie
    monthEvents.sort((a,b) => a.date - b.date);

    // Domyślne wyświetlenie listy CAŁEGO miesiąca przy zmianie miesiąca
    renderCalendarEventsList(monthEvents, `Wycielenia: ${date.toLocaleDateString('pl-PL', { month: 'long' })}`);

    // Ustawienie klkania w nagłówek (by zresetować filtr dnia)
    titleEl.style.cursor = 'pointer';
    titleEl.style.textDecoration = 'underline';
    titleEl.onclick = () => renderCalendarEventsList(monthEvents, `Wycielenia: ${date.toLocaleDateString('pl-PL', { month: 'long' })}`);

    const countBadge = document.getElementById('calMonthCount');
    countBadge.textContent = `+${monthEvents.length}`;
    countBadge.onclick = () => renderCalendarEventsList(monthEvents, `Wycielenia: ${date.toLocaleDateString('pl-PL', { month: 'long' })}`);

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    let startOffset = firstDay === 0 ? 6 : firstDay - 1;

    for (let i = 0; i < startOffset; i++) container.appendChild(document.createElement('div'));

    for (let d = 1; d <= daysInMonth; d++) {
        const dayDiv = document.createElement('div');
        dayDiv.className = 'cal-day';
        dayDiv.textContent = d;

        const dayEvents = monthEvents.filter(e => e.date.getDate() === d);
        
        if (dayEvents.length > 0) {
            dayDiv.classList.add('has-event');
            const dot = document.createElement('div');
            dot.className = 'cal-dot';
            dayDiv.appendChild(dot);
            
            // Po kliknięciu w dzień - filtruj tylko ten dzień
            dayDiv.onclick = () => {
                renderCalendarEventsList(dayEvents, `Wycielenia: ${d}.${month+1}`);
            };
        }

        const t = new Date();
        if (d === t.getDate() && month === t.getMonth() && year === t.getFullYear()) dayDiv.classList.add('today');

        container.appendChild(dayDiv);
    }
}

// --- KONFIGURACJA (POPRAWIONA LISTA) ---

function renderConfig() {
    const list = document.getElementById('configList');
    list.innerHTML = '';

    // Pomocnicza funkcja do tekstu w nawiasie
    const getBaseText = (base) => {
        if(base === 'insem') return '(od daty zacielenia)';
        if(base === 'calving' || base === 'calving_minus') return '(od daty wycielenia)';
        return '';
    };

    const createInput = (key, rule) => {
        const div = document.createElement('div');
        div.className = 'config-item';
        // Tutaj dodajemy <span> z opisem bazy
        div.innerHTML = `
            <div style="display:flex; flex-direction:column;">
                <span>${rule.label}</span>
                <span style="font-size:10px; color:#999;">${getBaseText(rule.base)}</span>
            </div>
            <div class="config-inputs">
                <input type="number" id="cfg_start_${key}" value="${rule.start}"> - 
                <input type="number" id="cfg_end_${key}" value="${rule.end}">
                <input type="checkbox" id="cfg_enable_${key}" ${rule.enabled ? 'checked' : ''}>
            </div>
        `;
        list.appendChild(div);
    };

    ['usg', 'heat', 'dry', 'rovac', 'kexxtone'].forEach(k => createInput(k, userSettings[k]));

    // Custom
    userSettings.customRules.forEach((rule, idx) => {
        const div = document.createElement('div');
        div.className = 'config-item';
        div.innerHTML = `
            <div style="display:flex; flex-direction:column;">
                <span>${rule.label}</span>
                <span style="font-size:10px; color:#999;">${getBaseText(rule.base)}</span>
            </div>
            <div class="config-inputs">
                <input type="number" id="cfg_cust_start_${idx}" value="${rule.start}"> - 
                <input type="number" id="cfg_cust_end_${idx}" value="${rule.end}">
                <button class="btn-danger" style="padding:2px 8px;" onclick="removeCustomRule(${idx})">X</button>
            </div>
        `;
        list.appendChild(div);
    });
}

function saveConfiguration() {
    ['usg', 'heat', 'dry', 'rovac', 'kexxtone'].forEach(k => {
        userSettings[k].start = parseInt(document.getElementById(`cfg_start_${k}`).value);
        userSettings[k].end = parseInt(document.getElementById(`cfg_end_${k}`).value);
        userSettings[k].enabled = document.getElementById(`cfg_enable_${k}`).checked;
    });

    userSettings.customRules.forEach((r, idx) => {
        const s = document.getElementById(`cfg_cust_start_${idx}`);
        const e = document.getElementById(`cfg_cust_end_${idx}`);
        if(s && e) {
            r.start = parseInt(s.value);
            r.end = parseInt(e.value);
        }
    });

    db.collection('konfiguracja').doc(currentUser.id).collection('settings').doc('tasks').set(userSettings)
      .then(() => {
          alert("Ustawienia zapisane!");
          generateAndRenderTasks();
      });
}

document.getElementById('customTaskForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('newCfgName').value;
    const base = document.getElementById('newCfgBase').value;
    const s = parseInt(document.getElementById('newCfgStart').value);
    const end = parseInt(document.getElementById('newCfgEnd').value);

    userSettings.customRules.push({
        label: name, base: base, start: s, end: end, enabled: true
    });
    
    renderConfig();
    document.getElementById('customTaskForm').reset();
});

function removeCustomRule(idx) {
    userSettings.customRules.splice(idx, 1);
    renderConfig();
}

function resetConfiguration() {
    if(confirm("Przywrócić domyślne?")) {
        userSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
        renderConfig();
    }
}

// --- HELPERY UI ---

function switchTaskFilter(mode) {
    currentTaskFilter = mode;
    document.querySelectorAll('.sub-tab').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
    generateAndRenderTasks();
}

function showListModal(title, animals) {
    document.getElementById('listModalTitle').textContent = title;
    const content = document.getElementById('listModalContent');
    content.innerHTML = '';
    
    animals.forEach(a => {
        const d = document.createElement('div');
        d.className = 'card';
        d.style.padding = '10px';
        d.innerHTML = `🐮 <b>${a.tag}</b>`;
        d.onclick = () => { closeModal('listModal'); openAnimalCard(a.id); };
        content.appendChild(d);
    });
    
    document.getElementById('listModal').style.display = 'flex';
}

function openAnimalCard(id) {
    const animal = myHerd.find(a => a.id === id);
    if (!animal) return;
    
    document.getElementById('cardTag').textContent = animal.tag;
    document.getElementById('cardDob').textContent = animal.dob;
    document.getElementById('cardType').textContent = animal.type;
    
    const today = new Date();
    const dob = new Date(animal.dob);
    const months = Math.floor((today - dob) / (1000 * 60 * 60 * 24 * 30));
    document.getElementById('cardAge').textContent = `${months} msc`;

    document.getElementById('cardLastCalving').textContent = animal.lastCalving || '-';
    document.getElementById('cardLastInsem').textContent = animal.lastInsemination || '-';
    document.getElementById('cardSemen').textContent = animal.semen || '-';
    
    if(animal.lastCalving) {
        const dim = Math.floor((today - new Date(animal.lastCalving)) / (1000 * 60 * 60 * 24));
        document.getElementById('cardDim').textContent = `${dim} dni`;
    } else {
        document.getElementById('cardDim').textContent = '-';
    }

    const statEl = document.getElementById('cardPregStatus');
    if (animal.isPregnantConfirmed) {
        statEl.textContent = "✅ CIELNA";
        statEl.style.color = "green";
    } else if (animal.usgStatus === 'negative') {
        statEl.textContent = "❌ PUSTA (Niecielna)";
        statEl.style.color = "red";
    } else if (animal.lastInsemination) {
        statEl.textContent = "❓ Do badania";
        statEl.style.color = "orange";
    } else {
        statEl.textContent = "Oczekiwanie";
        statEl.style.color = "#777";
    }

    const histDiv = document.getElementById('cardHistory');
    histDiv.innerHTML = '';
    const h = animal.historyInsemination || [];
    [...h].reverse().forEach(x => {
        const p = document.createElement('div');
        p.style.borderBottom = '1px solid #eee';
        p.style.padding = '5px 0';
        p.innerHTML = `💉 ${x.date} (${x.bull})`;
        histDiv.appendChild(p);
    });

    document.getElementById('btnDeleteAnimal').onclick = () => {
        if(confirm("Usunąć?")) {
            db.collection('animals').doc(id).delete();
            closeModal('animalCardModal');
        }
    };

    document.getElementById('animalCardModal').style.display = 'flex';
}

function setupModals() {
    window.closeModal = (id) => document.getElementById(id).style.display = 'none';
    window.openAnimalModal = () => document.getElementById('animalModal').style.display = 'flex';
    
    document.getElementById('inpType').addEventListener('change', (e) => {
        if(e.target.value === 'krowa') document.getElementById('cowFields').classList.remove('hidden');
        else document.getElementById('cowFields').classList.add('hidden');
    });

    document.getElementById('animalForm').addEventListener('submit', (e) => {
        e.preventDefault();
        db.collection('animals').add({
            ownerUid: currentUser.uid,
            tag: document.getElementById('inpTag').value,
            type: document.getElementById('inpType').value,
            dob: document.getElementById('inpDob').value,
            lastCalving: document.getElementById('inpLastCalving').value || null,
            lastInsemination: document.getElementById('inpLastInsem').value || null,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }).then(() => {
            alert("Dodano!");
            closeModal('animalModal');
            document.getElementById('animalForm').reset();
        });
    });
}

function setupNavigation() {
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
            document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
            document.getElementById(btn.dataset.target).classList.add('active');
            btn.classList.add('active');
        });
    });
    document.getElementById('logoutBtn').addEventListener('click', () => {
        auth.signOut();
    });
}

function switchSection(id) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    // Znajdź przycisk nawigacji
    const navBtn = document.querySelector(`.nav-item[data-target="${id}"]`);
    if(navBtn) navBtn.classList.add('active');
}

function updateDashboardStats() {
    document.getElementById('cntCows').textContent = myHerd.filter(a => a.type === 'krowa').length;
    document.getElementById('cntHeifers').textContent = myHerd.filter(a => a.type === 'jalowka').length;
    document.getElementById('cntBulls').textContent = myHerd.filter(a => a.type === 'byk').length;
}

function addDays(date, days) {
    const r = new Date(date);
    r.setDate(r.getDate() + days);
    return r;
}
