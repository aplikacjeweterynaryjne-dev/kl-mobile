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
let currentTaskFilter = 'todo'; 
let currentTypeFilter = 'all';

// Ustawienia Domyślne
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

// --- AUTH ---
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
    
    loadSettings().then(() => {
        loadHerd(); 
        loadCompletedTasks();
        renderConfig();
    });
    
    setupNavigation();
    setupModals();
    renderCalendar(new Date());
    
    const insemDateEl = document.getElementById('insemDate');
    if(insemDateEl) insemDateEl.valueAsDate = new Date();
}

// --- ŁADOWANIE DANYCH ---

async function loadSettings() {
    try {
        if(!currentUser || !currentUser.id) return;
        const doc = await db.collection('konfiguracja').doc(currentUser.id).collection('settings').doc('tasks').get();
        if (doc.exists) {
            const saved = doc.data();
            userSettings = { ...DEFAULT_SETTINGS, ...saved };
        }
    } catch (e) { console.error("Błąd ustawień (load):", e); }
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
    
    db.collection('task_logs')
      .where('ownerUid', '==', currentUser.uid)
      .where('completedAt', '>=', dateLimit)
      .onSnapshot(snap => {
          completedTasks = [];
          snap.forEach(doc => {
              const data = doc.data();
              if(data.completedAt) {
                  completedTasks.push({ logId: doc.id, ...data });
              }
          });
          generateAndRenderTasks();
      }, error => console.error("Błąd logów:", error));
}

// --- SILNIK ZADAŃ ---

function generateAndRenderTasks() {
    const today = new Date();
    today.setHours(0,0,0,0);

    let generatedTasks = [];

    myHerd.forEach(animal => {
        // 1. SYNCHRONIZACJA
        if (animal.type === 'krowa' && animal.lastCalving) {
            const calvDate = new Date(animal.lastCalving);
            const dim = Math.floor((today - calvDate) / (1000 * 60 * 60 * 24));

            if (dim > 60 && dim < 365) {
                if (!animal.isPregnantConfirmed && animal.usgStatus !== 'pending') {
                    const history = animal.historyInsemination || [];
                    const insemsSinceCalving = history.filter(h => new Date(h.date) > calvDate).length;

                    if (insemsSinceCalving <= 6) {
                        addTask(generatedTasks, animal, 'Wykonaj synchronizację', today, today, 'warning', 'sync', null, calvDate);
                    }
                }
            }
        }

        // 2. STANDARDOWE
        if (animal.type !== 'krowa' && animal.type !== 'jalowka') return;
        if (!animal.lastInsemination) return;
        if (animal.usgStatus === 'negative') return; 

        const insDate = new Date(animal.lastInsemination);
        const gestDays = userSettings.gestation || 280;
        const calvingDate = addDays(insDate, gestDays);
        const daysSinceInsem = Math.floor((today - insDate) / (1000 * 60 * 60 * 24));

        if (!animal.isPregnantConfirmed) {
            checkRuleAndAddTask(generatedTasks, animal, userSettings.usg, daysSinceInsem, insDate, 'usg', calvingDate);
            checkRuleAndAddTask(generatedTasks, animal, userSettings.heat, daysSinceInsem, insDate, 'heat', calvingDate);
        }

        const daysToCalving = Math.floor((calvingDate - today) / (1000 * 60 * 60 * 24));
        
        if (animal.type === 'krowa') {
             checkRuleAndAddTask(generatedTasks, animal, userSettings.dry, daysToCalving, calvingDate, 'dry', calvingDate, true);
        }
        checkRuleAndAddTask(generatedTasks, animal, userSettings.rovac, daysToCalving, calvingDate, 'rovac', calvingDate, true);
        checkRuleAndAddTask(generatedTasks, animal, userSettings.kexxtone, daysToCalving, calvingDate, 'kexxtone', calvingDate, true);

        // Custom
        userSettings.customRules.forEach((rule, idx) => {
            if(rule.base === 'insem') {
                checkRuleAndAddTask(generatedTasks, animal, rule, daysSinceInsem, insDate, `custom_${idx}`, calvingDate);
            } else {
                checkRuleAndAddTask(generatedTasks, animal, rule, daysToCalving, calvingDate, `custom_${idx}`, calvingDate, true);
            }
        });
        
        // 3. WYCIELENIE (Automat)
        if (daysToCalving <= 10 && daysToCalving >= -15) { 
            const isDone = checkIfTaskDone(animal.id, 'calving', calvingDate);
            
            if (!isDone && daysToCalving <= -13) {
                confirmTaskCalving({ animalId: animal.id, dueDate: calvingDate }, calvingDate, true);
            } else if (!isDone) {
                let priority = 'urgent';
                let isOverdueCalving = false;

                if (daysToCalving < -5) {
                    isOverdueCalving = true; 
                } else if (daysToCalving <= 5 && daysToCalving >= -5) {
                    priority = 'urgent'; 
                } else {
                    priority = 'warning'; 
                }
                addTask(generatedTasks, animal, 'Spodziewane Wycielenie', calvingDate, calvingDate, priority, 'calving', insDate, calvingDate, isOverdueCalving);
            }
        }
    });

    renderTasks(generatedTasks);
}

function checkIfTaskDone(animalId, type, refDate) {
    const dateStr = refDate.toISOString().split('T')[0];
    const taskId = `${animalId}_${type}_${dateStr}`;
    return completedTasks.find(t => t.taskId === taskId);
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

function addTask(list, animal, title, dueDate, sortDate, priority, type, insemDate, calvDate, forceOverdue = false) {
    const dateStr = dueDate.toISOString().split('T')[0];
    const taskId = `${animal.id}_${type}_${dateStr}`;
    const doneLog = completedTasks.find(t => t.taskId === taskId);

    let isReallyOverdue = false;
    if (forceOverdue) {
        isReallyOverdue = true;
    } else if (priority === 'urgent' && type !== 'calving') {
        isReallyOverdue = true;
    }

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
        calvDate: calvDate,
        isReallyOverdue: isReallyOverdue
    });
}

function renderTasks(tasks) {
    const container = document.getElementById('tasksContainer');
    container.innerHTML = '';

    const today = new Date();
    today.setHours(0,0,0,0);
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    let filtered = tasks;

    if (currentTaskFilter === 'done') filtered = tasks.filter(t => t.isDone);
    else if (currentTaskFilter === 'todo') filtered = tasks.filter(t => !t.isDone && !t.isReallyOverdue);
    else if (currentTaskFilter === 'overdue') filtered = tasks.filter(t => !t.isDone && t.isReallyOverdue);
    else if (currentTaskFilter === 'month') filtered = tasks.filter(t => !t.isDone && t.dueDate >= startOfMonth && t.dueDate <= endOfMonth);

    if (currentTypeFilter !== 'all') filtered = filtered.filter(t => t.type === currentTypeFilter);

    filtered.sort((a,b) => a.dueDate - b.dueDate);

    renderTaskTypeChips(tasks);

    if (filtered.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:20px; color:#999;">Brak zadań w tym widoku.</div>';
        return;
    }

    filtered.forEach(t => {
        const div = document.createElement('div');
        div.className = `task-item ${t.priority} ${t.isDone ? 'done' : ''}`;
        const dueStr = t.dueDate.toLocaleDateString('pl-PL');
        const calvStr = t.calvDate ? t.calvDate.toLocaleDateString('pl-PL') : '-';
        const dateColor = t.isReallyOverdue ? 'red' : (t.priority === 'urgent' ? '#e67e22' : '#333'); 

        div.innerHTML = `
            <div style="flex:1;">
                <div style="font-size:15px; font-weight:bold; color:#333;">${t.title}</div>
                <div class="task-dates">
                    <span>📅 Termin: <b style="color:${dateColor}">${dueStr}</b></span>
                    ${t.type === 'calving' ? '' : `<span>👶 Wyc: ${calvStr}</span>`}
                </div>
                <div class="task-animal-tag" onclick="openAnimalCard('${t.animalId}')">${t.tag}</div>
            </div>
            <div style="margin-left:10px; display:flex; align-items:center;">
                ${t.isDone 
                    ? `<button class="btn" style="padding:5px 10px; font-size:12px; background:#ddd;" onclick="undoTask('${t.logId}')">Cofnij</button>`
                    : `<input type="checkbox" style="transform:scale(1.5); cursor:pointer;" onclick="initiateTaskCompletion('${t.id}', '${t.type}', '${t.animalId}', '${t.dueDate.toISOString()}')">`
                }
            </div>
        `;
        container.appendChild(div);
    });
}

function renderTaskTypeChips(allTasks) {
    const container = document.getElementById('taskTypeChips');
    container.innerHTML = '';
    
    const counts = {};
    const types = new Set(['all']);
    
    allTasks.forEach(t => { 
        if(!t.isDone && !t.isReallyOverdue) {
            types.add(t.type);
            counts[t.type] = (counts[t.type] || 0) + 1;
        }
    });
    
    const labels = {
        'all': 'Wszystkie', 'usg': 'USG', 'heat': 'Ruja', 
        'dry': 'Zasuszenie', 'rovac': 'Rovac', 'kexxtone': 'Kexxtone', 'calving': 'Wycielenia', 'sync': 'Synchronizacja'
    };

    const typesToShow = Array.from(types);
    if(typesToShow.length === 0 && currentTypeFilter === 'all') typesToShow.push('all');

    typesToShow.forEach(type => {
        let label = labels[type];
        if (!label && type.startsWith('custom_')) {
            const idx = parseInt(type.split('_')[1]);
            if (userSettings.customRules[idx]) label = userSettings.customRules[idx].label;
            else label = 'Własne';
        }
        if (!label) label = type;

        const count = counts[type] || 0;
        if (type !== 'all' && count > 0) label += ` (${count})`;

        const btn = document.createElement('button');
        btn.className = `filter-chip ${currentTypeFilter === type ? 'active' : ''}`;
        btn.textContent = label;
        btn.onclick = () => { currentTypeFilter = type; generateAndRenderTasks(); };
        container.appendChild(btn);
    });
}

// --- CONFIRM, WYCIELENIE ---

let pendingTask = null;

function initiateTaskCompletion(taskId, type, animalId, dueDateStr) {
    pendingTask = { taskId, type, animalId, dueDate: new Date(dueDateStr) };
    const modal = document.getElementById('taskConfirmModal');
    const txt = document.getElementById('taskConfirmText');
    
    document.getElementById('usgResultOptions').classList.add('hidden');
    document.getElementById('calvingConfirmOptions').classList.add('hidden');
    document.getElementById('standardConfirmBtns').classList.add('hidden');

    if (type === 'usg') {
        document.getElementById('usgResultOptions').classList.remove('hidden');
        txt.textContent = "Jaki jest wynik badania?";
    } else if (type === 'calving') {
        document.getElementById('calvingConfirmOptions').classList.remove('hidden');
        txt.textContent = "Potwierdź datę wycielenia:";
        const defDate = pendingTask.dueDate.toISOString().split('T')[0];
        document.getElementById('calvingRealDate').value = defDate;
    } else {
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

function confirmTaskCalvingUI() {
    if(!pendingTask) return;
    const realDate = document.getElementById('calvingRealDate').value;
    if(!realDate) return alert("Podaj datę!");
    confirmTaskCalving(pendingTask, new Date(realDate), false);
    closeModal('taskConfirmModal');
}

function confirmTaskCalving(taskData, calvingDate, isAuto) {
    const dateStr = calvingDate.toISOString().split('T')[0];
    saveTaskLog(taskData, `Wycielenie: ${dateStr} ${isAuto ? '(Automat)' : ''}`);
    db.collection('animals').doc(taskData.animalId).update({
        lastCalving: dateStr,
        lastInsemination: null, semen: null,
        isPregnantConfirmed: false, usgStatus: 'pending',
        type: 'krowa'
    });
}

function saveTaskLog(taskData, result) {
    const fakeLogId = 'temp_' + Date.now();
    completedTasks.push({
        logId: fakeLogId, taskId: taskData.taskId, taskType: taskData.type,
        animalId: taskData.animalId, result: result, completedAt: { toDate: () => new Date() }
    });
    generateAndRenderTasks();
    db.collection('task_logs').add({
        ownerUid: currentUser.uid, taskId: taskData.taskId, taskType: taskData.type,
        animalId: taskData.animalId, result: result, completedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
}

function undoTask(logId) {
    if(confirm("Cofnąć?")) {
        completedTasks = completedTasks.filter(t => t.logId !== logId);
        generateAndRenderTasks();
        if (!logId.startsWith('temp_')) db.collection('task_logs').doc(logId).delete();
    }
}

// --- POPULACJA LIST (DATALISTS) ---

function populateLists() {
    const tagList = document.getElementById('tagList');
    const semenList = document.getElementById('semenList');
    if(!tagList || !semenList) return;

    tagList.innerHTML = '';
    semenList.innerHTML = '';
    
    const tagMap = new Set();
    const semenMap = new Set();

    myHerd.forEach(a => {
        if(!tagMap.has(a.tag)) {
            const opt = document.createElement('option');
            opt.value = a.tag; 
            tagList.appendChild(opt);
            tagMap.add(a.tag);
        }
        if(a.semen) semenMap.add(a.semen);
        if(a.historyInsemination) {
            a.historyInsemination.forEach(h => { if(h.bull) semenMap.add(h.bull); });
        }
    });

    semenMap.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s;
        semenList.appendChild(opt);
    });
}

// --- KARTA ZWIERZĘCIA I EDYCJA ---

let currentEditingAnimalId = null;

function openAnimalCard(id) {
    const animal = myHerd.find(a => a.id === id);
    if (!animal) return;
    currentEditingAnimalId = id;
    
    document.getElementById('viewMode').classList.remove('hidden');
    document.getElementById('editMode').classList.add('hidden');

    document.getElementById('cardTag').textContent = animal.tag;
    document.getElementById('cardDob').textContent = animal.dob;
    
    const today = new Date();
    let totalDim = 0;
    let countDim = 0;
    myHerd.forEach(h => {
        if(h.type === 'krowa' && h.lastCalving) {
            const d = Math.floor((today - new Date(h.lastCalving)) / (1000 * 60 * 60 * 24));
            if(d > 0) { totalDim += d; countDim++; }
        }
    });
    const avgDim = countDim > 0 ? Math.floor(totalDim / countDim) : 0;

    let cowDim = '-';
    if(animal.lastCalving) {
        cowDim = Math.floor((today - new Date(animal.lastCalving)) / (1000 * 60 * 60 * 24));
    }
    document.getElementById('cardDimStat').innerHTML = `DIM: <b>${cowDim}</b> (Śr. stada: ${avgDim})`;

    // WYPEŁNIANIE PÓL EDYCJI
    document.getElementById('editTag').value = animal.tag;
    document.getElementById('editDob').value = animal.dob;
    document.getElementById('editLastCalving').value = animal.lastCalving || '';
    document.getElementById('editLastInsem').value = animal.lastInsemination || '';

    // Ustawienie statusu cielności w edycji
    let statusVal = 'unknown';
    if (animal.isPregnantConfirmed) statusVal = 'pregnant';
    else if (animal.usgStatus === 'negative') statusVal = 'negative';
    else if (animal.usgStatus === 'pending' || (animal.lastInsemination && !animal.isPregnantConfirmed)) statusVal = 'check';
    document.getElementById('editPregStatus').value = statusVal;

    const histDiv = document.getElementById('cardHistory');
    histDiv.innerHTML = '';
    const h = animal.historyInsemination || [];
    
    h.map((val, idx) => ({val, idx})).reverse().forEach(item => {
        const x = item.val;
        const row = document.createElement('div');
        row.style.cssText = 'border-bottom:1px solid #eee; padding:5px 0; display:flex; justify-content:space-between; align-items:center;';
        row.innerHTML = `
            <span>💉 ${x.date} <small>(${x.bull})</small></span>
            <button class="btn-danger" style="padding:2px 8px; font-size:10px;" onclick="deleteInsemination('${id}', ${item.idx})">🗑</button>
        `;
        histDiv.appendChild(row);
    });

    document.getElementById('btnDeleteAnimal').onclick = () => {
        if(confirm("Usunąć trwale?")) {
            db.collection('animals').doc(id).delete();
            closeModal('animalCardModal');
        }
    };

    document.getElementById('animalCardModal').style.display = 'flex';
}

function toggleEditMode() {
    const view = document.getElementById('viewMode');
    const edit = document.getElementById('editMode');
    if (view.classList.contains('hidden')) {
        view.classList.remove('hidden');
        edit.classList.add('hidden');
    } else {
        view.classList.add('hidden');
        edit.classList.remove('hidden');
    }
}

function saveAnimalChanges() {
    if(!currentEditingAnimalId) return;
    
    const newTag = document.getElementById('editTag').value;
    const dob = document.getElementById('editDob').value;
    const lastCalving = document.getElementById('editLastCalving').value || null;
    const lastInsem = document.getElementById('editLastInsem').value || null;
    const newStatus = document.getElementById('editPregStatus').value;

    let isPreg = false;
    let usg = 'pending';

    if(newStatus === 'pregnant') { isPreg = true; usg = 'positive'; }
    else if(newStatus === 'negative') { isPreg = false; usg = 'negative'; }
    else if(newStatus === 'check') { isPreg = false; usg = 'pending'; }
    else { isPreg = false; usg = 'pending'; } // unknown

    db.collection('animals').doc(currentEditingAnimalId).update({
        tag: newTag,
        dob: dob, 
        lastCalving: lastCalving, 
        lastInsemination: lastInsem,
        isPregnantConfirmed: isPreg,
        usgStatus: usg
    }).then(() => {
        alert("Zapisano zmiany!");
        openAnimalCard(currentEditingAnimalId);
    });
}

function deleteInsemination(animalId, index) {
    if(!confirm("Usunąć ten wpis?")) return;
    const animal = myHerd.find(a => a.id === animalId);
    if(!animal) return;
    
    const newHistory = [...animal.historyInsemination];
    newHistory.splice(index, 1);
    
    let newLastInsem = null;
    let newSemen = null;
    if(newHistory.length > 0) {
        const sorted = [...newHistory].sort((a,b) => new Date(b.date) - new Date(a.date));
        newLastInsem = sorted[0].date;
        newSemen = sorted[0].bull;
    }

    db.collection('animals').doc(animalId).update({
        historyInsemination: newHistory, lastInsemination: newLastInsem, semen: newSemen
    }).then(() => {
        openAnimalCard(animalId);
    });
}

// --- ZARZĄDZANIE MODALAMI I FORMULARZAMI (Fix submitów) ---

function setupModals() {
    window.closeModal = (id) => document.getElementById(id).style.display = 'none';
    
    window.openAnimalModal = () => {
        document.getElementById('animalForm').reset();
        document.getElementById('animalModal').style.display = 'flex';
        document.getElementById('cowFields').classList.remove('hidden');
        document.getElementById('inpType').value = 'krowa';
    };
    
    document.getElementById('inpType').addEventListener('change', (e) => {
        const type = e.target.value;
        if(type === 'krowa' || type === 'jalowka') {
            document.getElementById('cowFields').classList.remove('hidden');
        } else {
            document.getElementById('cowFields').classList.add('hidden');
        }
    });

    // Formularz INSEMINACJI
    document.getElementById('insemForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const tagVal = document.getElementById('insemTagInput').value; 
        const date = document.getElementById('insemDate').value;
        const bull = document.getElementById('insemBull').value;
        const note = document.getElementById('insemNote').value;

        const animal = myHerd.find(a => a.tag === tagVal);
        if(!animal) {
            alert("Nie znaleziono zwierzęcia o takim numerze! Sprawdź listę.");
            return;
        }

        const newHistory = { date, bull, note, added: new Date().toISOString() };
        const history = animal.historyInsemination || [];
        history.push(newHistory);

        db.collection('animals').doc(animal.id).update({
            lastInsemination: date, semen: bull, historyInsemination: history,
            isPregnantConfirmed: false, usgStatus: 'pending'
        }).then(() => {
            alert("Zapisano inseminację!");
            document.getElementById('insemForm').reset();
            document.getElementById('insemDate').valueAsDate = new Date();
            closeModal('insemModal');
        }).catch(err => alert("Błąd zapisu: " + err.message));
    });

    // Formularz DODAWANIA ZWIERZĘCIA
    document.getElementById('animalForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const type = document.getElementById('inpType').value;
        const tag = document.getElementById('inpTag').value;
        const dob = document.getElementById('inpDob').value;
        const lastCalving = document.getElementById('inpLastCalving').value || null;
        const lastInsem = document.getElementById('inpLastInsem').value || null; // Fix nazwy zmiennej
        const semen = document.getElementById('inpSemen').value || null;
        const pregStatus = document.getElementById('inpPregStatus').value;

        let isPregnantConfirmed = false;
        let usgStatus = 'pending';

        if (pregStatus === 'pregnant') { isPregnantConfirmed = true; usgStatus = 'positive'; } 
        else if (pregStatus === 'check') { isPregnantConfirmed = false; usgStatus = 'pending'; } 
        else { usgStatus = 'negative'; if(lastInsem) usgStatus = 'pending'; }

        let historyInsemination = [];
        if(lastInsem) {
            historyInsemination.push({ date: lastInsem, bull: semen || 'Nieznany', note: 'Start', added: new Date().toISOString() });
        }

        db.collection('animals').add({
            ownerUid: currentUser.uid, tag, type, dob, lastCalving, 
            lastInsemination: lastInsem, 
            semen, historyInsemination, isPregnantConfirmed, usgStatus,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }).then(() => {
            alert("Dodano zwierzę!");
            closeModal('animalModal');
        }).catch(err => alert("Błąd dodawania: " + err.message));
    });
}

// --- KONFIGURACJA ---

function renderConfig() {
    const list = document.getElementById('configList');
    list.innerHTML = '';

    const getBaseText = (base) => {
        if(base === 'insem') return '(od daty zacielenia)';
        if(base === 'calving' || base === 'calving_minus') return '(od daty wycielenia)';
        return '';
    };

    const createInput = (key, rule) => {
        const div = document.createElement('div');
        div.className = 'config-item';
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

function saveConfiguration(fromDOM = true) {
    if(!currentUser || !currentUser.id) {
        alert("Błąd: Nie znaleziono ID konfiguracji użytkownika.");
        return Promise.reject("No user config ID");
    }

    if(fromDOM) {
        ['usg', 'heat', 'dry', 'rovac', 'kexxtone'].forEach(k => {
            const s = document.getElementById(`cfg_start_${k}`);
            const e = document.getElementById(`cfg_end_${k}`);
            const en = document.getElementById(`cfg_enable_${k}`);
            if(s) userSettings[k].start = parseInt(s.value);
            if(e) userSettings[k].end = parseInt(e.value);
            if(en) userSettings[k].enabled = en.checked;
        });

        userSettings.customRules.forEach((r, idx) => {
            const s = document.getElementById(`cfg_cust_start_${idx}`);
            const e = document.getElementById(`cfg_cust_end_${idx}`);
            if(s && e) {
                r.start = parseInt(s.value);
                r.end = parseInt(e.value);
            }
        });
    }

    return db.collection('konfiguracja').doc(currentUser.id).collection('settings').doc('tasks').set(userSettings);
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
    
    saveConfiguration(false).then(() => {
        alert(`Dodano nowe zadanie: ${name}`);
        renderConfig();
        document.getElementById('customTaskForm').reset();
    }).catch(err => alert("Błąd zapisu: " + err.message));
});

function removeCustomRule(idx) {
    if(!confirm("Usunąć to zadanie?")) return;
    userSettings.customRules.splice(idx, 1);
    saveConfiguration(false).then(() => renderConfig());
}

function resetConfiguration() {
    if(confirm("Przywrócić ustawienia domyślne?")) {
        userSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
        saveConfiguration(false).then(() => renderConfig());
    }
}

// --- HELPERY ---

function setDateInput(id, deltaDays) {
    const el = document.getElementById(id);
    const d = new Date();
    d.setDate(d.getDate() + deltaDays);
    el.valueAsDate = d;
}

function openInsemModal() { document.getElementById('insemModal').style.display = 'flex'; }
function switchTaskFilter(mode) { currentTaskFilter = mode; document.querySelectorAll('.sub-tab').forEach(b => b.classList.remove('active')); event.target.classList.add('active'); generateAndRenderTasks(); }
function filterHerd(type) { switchSection('section-herd'); renderHerdList(type); }
function renderHerdList(type) { 
    const list = document.getElementById('herdList'); list.innerHTML = '';
    let filtered = myHerd; if (type !== 'all') filtered = myHerd.filter(a => a.type === type);
    const search = document.getElementById('herdSearch').value.toLowerCase();
    if (search) filtered = filtered.filter(a => a.tag.toLowerCase().includes(search));
    document.getElementById('herdTitle').textContent = type === 'all' ? 'Pełna Lista' : `Lista: ${type.toUpperCase()}`;
    const today = new Date();
    filtered.forEach(a => {
        let detailsHtml = ''; let statusIcon = '';
        if (a.type === 'krowa' || a.type === 'jalowka') {
            if (a.isPregnantConfirmed) statusIcon = '✅ Cielna'; else if (a.usgStatus === 'negative') statusIcon = '❌ Pusta'; else if (a.lastInsemination) statusIcon = '❓ Do badania'; else statusIcon = '⚪ Oczekiwanie';
            const ins = a.lastInsemination ? a.lastInsemination : '-';
            let calv = '-'; let dim = '-';
            if (a.lastInsemination) { const est = addDays(new Date(a.lastInsemination), userSettings.gestation || 280); calv = est.toLocaleDateString('pl-PL'); }
            if (a.lastCalving) { const days = Math.floor((today - new Date(a.lastCalving)) / (1000 * 60 * 60 * 24)); dim = `${days} dni`; }
            detailsHtml = `<div style="font-size:11px; color:#555; margin-top:5px; display:grid; grid-template-columns: 1fr 1fr; gap:5px;"><span>💉 Ost. zac: <b>${ins}</b></span><span>👶 Termin: <b>${calv}</b></span><span>📊 Laktacja: <b>${dim}</b></span><span style="font-weight:bold; color:${a.isPregnantConfirmed?'green':'#555'}">${statusIcon}</span></div>`;
        }
        const div = document.createElement('div'); div.className = 'card'; div.style.padding = '10px';
        div.innerHTML = `<div style="display:flex; justify-content:space-between; align-items:center;"><strong style="color:#2e7d32; font-size:16px;">${a.tag}</strong><span class="badge" style="background:#eee; color:#333;">${a.type}</span></div>${detailsHtml}`;
        div.onclick = () => openAnimalCard(a.id);
        list.appendChild(div);
    });
}
document.getElementById('herdSearch').addEventListener('input', () => renderHerdList('all'));
function renderLactationChart() { 
    const ctx = document.getElementById('lactationChart'); const buckets = [0, 0, 0, 0, 0, 0, 0]; const bucketAnimals = [[], [], [], [], [], [], []]; const today = new Date();
    myHerd.forEach(a => { if (a.type === 'krowa' && a.lastCalving) { const calvDate = new Date(a.lastCalving); const months = (today - calvDate) / (1000 * 60 * 60 * 24 * 30.4); let idx = 0; if (months <= 2) idx = 0; else if (months <= 4) idx = 1; else if (months <= 6) idx = 2; else if (months <= 8) idx = 3; else if (months <= 10) idx = 4; else if (months <= 12) idx = 5; else idx = 6; buckets[idx]++; bucketAnimals[idx].push(a); } });
    if (window.myChart) window.myChart.destroy(); window.myChart = new Chart(ctx, { type: 'bar', data: { labels: ['0-2m', '2-4m', '4-6m', '6-8m', '8-10m', '10-12m', '>12m'], datasets: [{ label: 'Sztuk', data: buckets, backgroundColor: '#2e7d32', borderRadius: 4 }] }, options: { plugins: { legend: { display: false } }, onClick: (evt, activeEls) => { if (activeEls.length > 0) { const idx = activeEls[0].index; showListModal(`Laktacja: ${window.myChart.data.labels[idx]}`, bucketAnimals[idx]); } } } });
}
function addDays(date, days) { const r = new Date(date); r.setDate(r.getDate() + days); return r; }
let currentCalDate = new Date(); function changeMonth(delta) { currentCalDate.setMonth(currentCalDate.getMonth() + delta); renderCalendar(currentCalDate); }
function renderCalendar(date) { 
    const container = document.getElementById('calendarDays'); container.innerHTML = ''; const year = date.getFullYear(); const month = date.getMonth(); document.getElementById('calTitle').textContent = date.toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' });
    let monthEvents = []; myHerd.forEach(a => { if (!a.lastInsemination || a.usgStatus === 'negative') return; const est = addDays(new Date(a.lastInsemination), userSettings.gestation || 280); if (est.getFullYear() === year && est.getMonth() === month) { monthEvents.push({ animal: a, date: est }); } }); monthEvents.sort((a,b) => a.date - b.date);
    renderCalendarEventsList(monthEvents, `Wycielenia: ${date.toLocaleDateString('pl-PL', { month: 'long' })}`);
    document.getElementById('calMonthCount').textContent = `+${monthEvents.length}`;
    const firstDay = new Date(year, month, 1).getDay(); const daysInMonth = new Date(year, month + 1, 0).getDate(); let startOffset = firstDay === 0 ? 6 : firstDay - 1;
    for (let i = 0; i < startOffset; i++) container.appendChild(document.createElement('div'));
    for (let d = 1; d <= daysInMonth; d++) { const dayDiv = document.createElement('div'); dayDiv.className = 'cal-day'; dayDiv.textContent = d; const dayEvents = monthEvents.filter(e => e.date.getDate() === d); if (dayEvents.length > 0) { dayDiv.classList.add('has-event'); const dot = document.createElement('div'); dot.className = 'cal-dot'; dayDiv.appendChild(dot); dayDiv.onclick = () => { renderCalendarEventsList(dayEvents, `Wycielenia: ${d}.${month+1}`); }; } const t = new Date(); if (d === t.getDate() && month === t.getMonth() && year === t.getFullYear()) dayDiv.classList.add('today'); container.appendChild(dayDiv); }
}
function renderCalendarEventsList(events, title) { const list = document.getElementById('calEventsList'); list.innerHTML = ''; document.getElementById('calSelectedDateTitle').textContent = title; if (events.length === 0) { list.innerHTML = '<p style="color:#999; text-align:center;">Brak wydarzeń</p>'; return; } events.forEach(e => { const el = document.createElement('div'); el.className = 'card'; el.style.padding = '10px'; const dateStr = e.date.toLocaleDateString('pl-PL'); el.innerHTML = `<div style="display:flex; justify-content:space-between; align-items:center;"><span>🐮 <b>${e.animal.tag}</b></span><span style="font-size:11px; color:#555;">${dateStr}</span></div><div style="font-size:11px; color:#2e7d32;">Spodziewane wycielenie</div>`; el.onclick = () => openAnimalCard(e.animal.id); list.appendChild(el); }); }
function showListModal(title, animals) { document.getElementById('listModalTitle').textContent = title; const content = document.getElementById('listModalContent'); content.innerHTML = ''; animals.forEach(a => { const d = document.createElement('div'); d.className = 'card'; d.style.padding = '10px'; d.innerHTML = `🐮 <b>${a.tag}</b>`; d.onclick = () => { closeModal('listModal'); openAnimalCard(a.id); }; content.appendChild(d); }); document.getElementById('listModal').style.display = 'flex'; }
function updateDashboardStats() { document.getElementById('cntCows').textContent = myHerd.filter(a => a.type === 'krowa').length; document.getElementById('cntHeifers').textContent = myHerd.filter(a => a.type === 'jalowka').length; document.getElementById('cntBulls').textContent = myHerd.filter(a => a.type === 'byk').length; }
function setupNavigation() { document.querySelectorAll('.nav-item').forEach(btn => { btn.addEventListener('click', () => { switchSection(btn.dataset.target); }); }); document.getElementById('logoutBtn').addEventListener('click', () => { auth.signOut(); }); }
function switchSection(id) { document.querySelectorAll('.section').forEach(s => s.classList.remove('active')); document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active')); document.getElementById(id).classList.add('active'); const navBtn = document.querySelector(`.nav-item[data-target="${id}"]`); if(navBtn) navBtn.classList.add('active'); }
