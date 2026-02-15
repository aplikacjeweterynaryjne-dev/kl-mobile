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

// --- STAN APLIKACJI (ZMIENNE GLOBALNE) ---
let currentUser = null;
let myHerd = [];
let completedTasks = [];
let myTreatments = [];
let currentTaskFilter = 'todo'; 
let currentTypeFilter = 'all';
let currentCalDate = new Date(); 
let currentEditingAnimalId = null;
let activeHerdFilters = [];
// Ustawienia Domyślne
const DEFAULT_SETTINGS = {
    usg: { enabled: true, start: 45, end: 180, base: 'insem', label: 'Badanie USG' },
    heat: { enabled: true, start: 18, end: 24, base: 'insem', label: 'Powtórka Rui' },
    dry: { enabled: true, start: 40, end: 60, base: 'calving_minus', label: 'Zasuszenie' },
    sync: { enabled: true, start: 60, end: 70, base: 'calving', label: 'Synchronizacja' }, // DODANO
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
    
    // Wstawienie numeru gospodarstwa do inputa w opcjach
    if(currentUser.numer_gospodarstwa) {
        const farmInput = document.getElementById('cfgFarmNumber');
        if(farmInput) farmInput.value = currentUser.numer_gospodarstwa;
    }

    // Domyślne daty dla filtra leczenia (ostatnie 30 dni)
    const today = new Date();
    const lastMonth = new Date();
    lastMonth.setDate(today.getDate() - 30);
    
    const dateFromEl = document.getElementById('treatmentsDateFrom');
    const dateToEl = document.getElementById('treatmentsDateTo');
    
    if(dateFromEl) dateFromEl.valueAsDate = lastMonth;
    if(dateToEl) dateToEl.valueAsDate = today;

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

// --- FUNKCJE POMOCNICZE (GLOBALNE) ---

function addDays(date, days) { 
    const r = new Date(date); 
    r.setDate(r.getDate() + days); 
    return r; 
}

function setDateInput(id, deltaDays) {
    const el = document.getElementById(id);
    if(el) {
        const d = new Date();
        d.setDate(d.getDate() + deltaDays);
        el.valueAsDate = d;
    }
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

// --- KARTY LECZENIA ---

function saveFarmNumber() {
    const farmNumInput = document.getElementById('cfgFarmNumber');
    const farmNum = farmNumInput.value.trim();

    if(!farmNum) {
        alert("Wpisz numer gospodarstwa.");
        return;
    }

    db.collection('konfiguracja').doc(currentUser.id).update({ 
        numer_gospodarstwa: farmNum 
    }).then(() => {
        currentUser.numer_gospodarstwa = farmNum;
        alert("Numer gospodarstwa zapisany! Przejdź do zakładki Karty Leczenia i pobierz dane.");
        switchSection('section-treatments'); 
    }).catch(err => {
        alert("Błąd zapisu numeru: " + err.message);
    });
}

function loadTreatments() {
    const container = document.getElementById('treatmentsList');
    const farmNum = currentUser.numer_gospodarstwa;
    
    const dateFrom = document.getElementById('treatmentsDateFrom').value;
    const dateTo = document.getElementById('treatmentsDateTo').value;

    if(!farmNum) {
        if(container) container.innerHTML = '<div style="text-align:center; padding:20px; color:#999;">Wpisz i ZAPISZ numer gospodarstwa w Opcjach.</div>';
        return;
    }

    if(!dateFrom || !dateTo) {
        alert("Wybierz zakres dat.");
        return;
    }

    const farmNumbers = farmNum.split(',').map(s => s.trim()).filter(s => s.length > 0);
    if(farmNumbers.length === 0) return;

    if(container) container.innerHTML = '<div style="text-align:center; padding:20px; color:#555;">Pobieranie kart...</div>';

    // Zapytanie z filtrowaniem po dacie
    db.collection('archiwumKarty')
      .where('header.nrStada', 'in', farmNumbers)
      .where('header.dataWykonania', '>=', dateFrom)
      .where('header.dataWykonania', '<=', dateTo)
      .limit(50)
      .get()
      .then(snap => {
          myTreatments = [];
          snap.forEach(doc => {
              myTreatments.push({ id: doc.id, ...doc.data() });
          });
          
          myTreatments.sort((a,b) => {
              const dA = a.header?.dataWykonania ? new Date(a.header.dataWykonania) : new Date(0);
              const dB = b.header?.dataWykonania ? new Date(b.header.dataWykonania) : new Date(0);
              return dB - dA;
          });

          renderTreatments();
      })
      .catch(error => {
          console.error("Błąd pobierania kart:", error);
          let msg = error.message;
          if(error.code === 'failed-precondition') {
              msg = "Wymagany nowy indeks w bazie danych. Kliknij link w konsoli (F12).";
          }
          if(container) container.innerHTML = `<div style="text-align:center; color:red; padding:20px;">Błąd: ${msg}</div>`;
      });
}

function renderTreatments() {
    const container = document.getElementById('treatmentsList');
    if(!container) return;
    container.innerHTML = '';

    if(myTreatments.length === 0) {
        container.innerHTML = `
            <div style="text-align:center; padding:20px; color:#999;">
                Brak kart leczenia w wybranym okresie.<br>
                <small>Nr gosp: ${currentUser.numer_gospodarstwa}</small>
            </div>`;
        return;
    }

    myTreatments.forEach(card => {
        const h = card.header || {};
        const div = document.createElement('div');
        div.className = 'card';
        div.style.padding = '15px';
        div.style.borderLeft = '5px solid #2980b9'; 

        // Czysta lista - bez leków
        div.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
                <span style="font-weight:bold; font-size:16px; color:#333;">📅 ${h.dataWykonania || 'Brak daty'}</span>
                <span style="font-size:14px; color:#2980b9; font-weight:bold;">${h.nrDokumentu}</span>
            </div>
            <div style="font-size:14px; margin-bottom:15px; color:#555;">
                Lecznica: <strong>${h.nazwaLecznicy || 'Nieznana'}</strong>
            </div>
            
            <button class="btn primary small" style="width:100%; background-color: #34495e;" onclick="openClientPrintWindow('${card.id}')">
                📄 Zobacz szczegóły (A4)
            </button>
        `;
        container.appendChild(div);
    });
}

// --- GENEROWANIE OKNA A4 (PODGLĄD 1:1) ---

function openClientPrintWindow(cardId) {
    const card = myTreatments.find(c => c.id === cardId);
    if (!card) return;

    const header = card.header || {};
    header.podpisPosiadaczaImg = card.podpisPosiadacza || '';

    let rowsHTML = '';
    const savedRows = card.table || [];
    const findRowData = (logicalIndex) => savedRows.find(r => r.logicalIndex === logicalIndex);

    const cleanContent = (content) => {
        if (!content) return '';
        let text = content;
        if (content.includes('<')) {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = content;
            const input = tempDiv.querySelector('input, textarea');
            text = input ? (input.value + ' ' + (tempDiv.textContent || '')) : tempDiv.textContent;
        }
        return text.replace('📅', '').trim();
    };

    for (let i = 1; i <= 13; i++) {
        let logicalIndex = -1;
        let displayLp = '';

        if (i < 10) {
            logicalIndex = i - 1; 
            displayLp = `${i}.`;
        } else if (i === 10) {
            rowsHTML += `<tr><td colspan="8" style="text-align: left; font-weight: bold; padding: 2px 4px; background-color: #f9f9f9; font-size: 10pt;">Potwierdzenie nabycia produktu leczniczego weterynaryjnego/paszy leczniczej</td></tr>`;
            continue; 
        } else {
            logicalIndex = i - 2; 
            displayLp = `${i - 10}.`; 
        }

        const rowData = findRowData(logicalIndex);

        const opis = rowData ? cleanContent(rowData.opis) : '';
        const liczba = rowData ? cleanContent(rowData.liczba) : '';
        const rozpoznanie = rowData ? cleanContent(rowData.rozpoznanie) : '';
        const lek = rowData ? cleanContent(rowData.lek) : '';
        const seria = rowData ? cleanContent(rowData.seria) : '';
        const ilosc = rowData ? cleanContent(rowData.iloscDawka) : '';
        const karencja = rowData ? cleanContent(rowData.karencja) : '';

        rowsHTML += `
            <tr>
                <td style="text-align: center;">${displayLp}</td>
                <td>${opis}</td>
                <td style="text-align: center;">${liczba}</td>
                <td style="text-align: center;">${rozpoznanie}</td>
                <td>${lek}</td>
                <td style="text-align: center;">${seria}</td>
                <td>${ilosc}</td>
                <td>${karencja}</td>
            </tr>
        `;
    }

    const printWindow = window.open('', '_blank', 'width=1150,height=800,scrollbars=yes,resizable=yes');
    if (!printWindow) { alert('Zablokowano okno.'); return; }

    printWindow.document.write(generateA4HTML(header, rowsHTML));
    printWindow.document.close();
    printWindow.focus();
}

function generateA4HTML(header, rowsHTML) {
    return `
        <!DOCTYPE html>
        <html lang="pl">
        <head>
            <meta charset="utf-8">
            <title>Karta Leczenia</title>
            <link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700&display=swap" rel="stylesheet">
            <style>
                body { font-family: 'Nunito', sans-serif; background-color: #525659; margin: 0; padding: 0; display: block; }
                .print-controls { position: sticky; top: 0; left: 0; z-index: 1000; background: #333; padding: 10px; text-align: center; }
                .btn { padding: 8px 20px; cursor: pointer; border-radius: 4px; border:none; font-weight:bold; font-size: 16px; margin: 0 5px; color: white; }
                .btn-print { background: #4CAF50; }
                .btn-close { background: #f44336; }

                .page-sheet {
                    background: white;
                    width: 297mm; min-height: 210mm;
                    margin: 20px auto; padding: 10mm;
                    box-sizing: border-box; box-shadow: 0 0 15px rgba(0,0,0,0.2);
                }

                h2 { text-align: center; font-size: 12pt; margin: 0 0 5px 0; font-weight: 700; text-transform: uppercase; }
                
                .top-section { display: grid; grid-template-columns: 1fr 1fr 1fr; font-size: 9pt; margin-bottom: 5px; gap: 3px; }
                .top-section div { padding: 3px 4px; border: 1px solid #000; }
                .bold { font-weight: 700; }

                table { border-collapse: collapse; width: 100%; font-size: 9pt; margin-bottom: 3px; }
                th, td { border: 1px solid #000; padding: 2px 3px; text-align: left; vertical-align: middle; }
                th { background-color: #EBF5E6; text-align: center; font-weight: bold; font-size: 8pt; }
                .center-text { text-align: center; }
                
                p { font-size: 9pt; margin: 2px 0; }
                
                .signatures { display: flex; justify-content: space-between; margin-top: 10px; }
                .sig-box { display: flex; flex-direction: column; align-items: center; width: 40%; }
                .sig-label { font-weight: bold; margin-bottom: 0; font-size: 9pt; border-top: 1px dashed #000; padding-top: 5px; width: 100%; text-align: center; }
                .sig-img { display: block; height: 35px; width: 100%; object-fit: contain; margin-top: 1px; }
                .sig-name { margin-top: 0; font-size: 8pt; text-align: center; }

                @media print {
                    body { background-color: white; margin: 0; padding: 0; }
                    .print-controls { display: none; }
                    .page-sheet { margin: 0; padding: 0; box-shadow: none; width: 100%; transform: scale(0.85); transform-origin: top left; }
                    @page { size: A4 landscape; margin: 0.5cm; }
                }
            </style>
        </head>
        <body>
            <div class="print-controls">
                <button class="btn btn-print" onclick="window.print()">🖨️ Drukuj / PDF</button>
                <button class="btn btn-close" onclick="window.close()">❌ Zamknij</button>
            </div>
            
            <div class="page-sheet">
                <h2>KARTA LECZENIA ZWIERZĄT / EWIDENCJA LECZENIA</h2>
                
                <div class="top-section">
                    <div>
                        Nazwa i adres zakładu leczniczego:<br>
                        <span class="bold" style="font-size: 10pt;">${header.nazwaLecznicy}</span><br>
                        Data wykonania: <span class="bold">${header.dataWykonania}</span><br>
                        Nr stada: <span class="bold">${header.nrStada}</span>
                    </div>
                    <div>
                        Posiadacz zwierzęcia:<br>
                        <span class="bold" style="font-size: 10pt;">${header.klient}</span><br>
                        <span class="bold" style="font-size: 10pt;">${header.adresKlienta}</span>
                    </div>
                    <div>
                        Data zgłoszenia: <span class="bold">${header.dataZgloszenia}</span><br>
                        Nr dokumentu: <span class="bold" style="font-size: 10pt;">${header.nrDokumentu}</span>
                    </div>
                </div>

                <table>
                    <colgroup>
                        <col style="width: 30px;">
                        <col style="width: 20%;">
                        <col style="width: 50px;">
                        <col style="width: 15%;">
                        <col style="width: 18%;">
                        <col style="width: 8%;">
                        <col style="width: 12%;">
                        <col>
                    </colgroup>
                    <thead>
                        <tr>
                            <th rowspan="2">Lp.</th>
                            <th rowspan="2" class="center-text">Opis zwierzęcia</th>
                            <th rowspan="2" class="center-text">Liczba</th>
                            <th rowspan="2" class="center-text">Rozpoznanie</th>
                            <th colspan="3">Zastosowane produkty</th>
                            <th rowspan="2">Karencja / Uwagi</th>
                        </tr>
                        <tr>
                            <th>Nazwa</th>
                            <th>Seria</th>
                            <th>Ilość/Dawkowanie</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHTML}</tbody>
                </table>

                <p><b>Oświadczam, że nabyte produkty lecznicze weterynaryjne zostaną zastosowane zgodnie z zaleceniami.</b></p>

                <div class="signatures">
                    <div class="sig-box">
                        <span class="sig-label">Lekarz weterynarii</span>
                        ${header.podpisLekarzaImg ? `<img src="${header.podpisLekarzaImg}" class="sig-img">` : '<div style="height:35px;"></div>'}
                        <span class="sig-name">${header.podpisLekarzaLinia}</span>
                    </div>
                    <div class="sig-box">
                        <span class="sig-label">Podpis posiadacza zwierzęcia</span>
                        ${header.podpisPosiadaczaImg ? `<img src="${header.podpisPosiadaczaImg}" class="sig-img">` : '<div style="height:35px;"></div>'}
                    </div>
                </div>
            </div>
        </body>
        </html>
    `;
}

// --- SILNIK ZADAŃ I LOGIKA STADA ---

function generateAndRenderTasks() {
    const today = new Date();
    today.setHours(0,0,0,0);
    let generatedTasks = [];

    myHerd.forEach(animal => {
        // Synchronizacja
        if (animal.type === 'krowa' && animal.lastCalving) {
            const calvDate = new Date(animal.lastCalving);
            const dim = Math.floor((today - calvDate) / (1000 * 60 * 60 * 24));
            if (dim > 60 && dim < 365) {
                if (!animal.isPregnantConfirmed && animal.usgStatus !== 'pending') {
                    const history = animal.historyInsemination || [];
                    const insemsSinceCalving = history.filter(h => new Date(h.date) > calvDate).length;
                    if (insemsSinceCalving <= 6) addTask(generatedTasks, animal, 'Wykonaj synchronizację', today, today, 'warning', 'sync', null, calvDate);
                }
            }
        }
        
        if (animal.type !== 'krowa' && animal.type !== 'jalowka') return;
        if (!animal.lastInsemination) return;
        if (animal.usgStatus === 'negative') return; 

        const insDate = new Date(animal.lastInsemination);
        const calvingDate = addDays(insDate, userSettings.gestation || 280);
        const daysSinceInsem = Math.floor((today - insDate) / (1000 * 60 * 60 * 24));

        if (!animal.isPregnantConfirmed) {
            checkRuleAndAddTask(generatedTasks, animal, userSettings.usg, daysSinceInsem, insDate, 'usg', calvingDate);
            checkRuleAndAddTask(generatedTasks, animal, userSettings.heat, daysSinceInsem, insDate, 'heat', calvingDate);
        }
        
        const daysToCalving = Math.floor((calvingDate - today) / (1000 * 60 * 60 * 24));
        if (animal.type === 'krowa') checkRuleAndAddTask(generatedTasks, animal, userSettings.dry, daysToCalving, calvingDate, 'dry', calvingDate, true);
        checkRuleAndAddTask(generatedTasks, animal, userSettings.rovac, daysToCalving, calvingDate, 'rovac', calvingDate, true);
        checkRuleAndAddTask(generatedTasks, animal, userSettings.kexxtone, daysToCalving, calvingDate, 'kexxtone', calvingDate, true);
        
        userSettings.customRules.forEach((rule, idx) => {
            if(rule.base === 'insem') checkRuleAndAddTask(generatedTasks, animal, rule, daysSinceInsem, insDate, `custom_${idx}`, calvingDate);
            else checkRuleAndAddTask(generatedTasks, animal, rule, daysToCalving, calvingDate, `custom_${idx}`, calvingDate, true);
        });
        
        // Wycielenie (Bufor -5/+5)
        if (daysToCalving <= 10 && daysToCalving >= -15) { 
            const isDone = checkIfTaskDone(animal.id, 'calving', calvingDate);
            if (!isDone && daysToCalving <= -13) {
                confirmTaskCalving({ animalId: animal.id, dueDate: calvingDate }, calvingDate, true);
            } else if (!isDone) {
                let priority = 'urgent';
                let isOverdueCalving = false;
                if (daysToCalving < -5) isOverdueCalving = true; 
                else if (daysToCalving <= 5 && daysToCalving >= -5) priority = 'urgent'; 
                else priority = 'warning'; 
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
    let isActive = false; let isOverdue = false; let dueDate = null;
    if (isReverse) {
        if (daysCounter <= rule.start && daysCounter >= rule.end) isActive = true;
        if (daysCounter < rule.end) isOverdue = true;
        dueDate = addDays(calvDate, -rule.end);
    } else {
        if (daysCounter >= rule.start && daysCounter <= rule.end) isActive = true;
        if (daysCounter > rule.end) isOverdue = true;
        dueDate = addDays(refDate, rule.end);
    }
    if (isActive) addTask(list, animal, rule.label, dueDate, new Date(), 'warning', type, refDate, calvDate);
    else if (isOverdue) addTask(list, animal, rule.label, dueDate, new Date(), 'urgent', type, refDate, calvDate);
}

function addTask(list, animal, title, dueDate, sortDate, priority, type, insemDate, calvDate, forceOverdue = false) {
    const dateStr = dueDate.toISOString().split('T')[0];
    const taskId = `${animal.id}_${type}_${dateStr}`;
    const doneLog = completedTasks.find(t => t.taskId === taskId);
    let isReallyOverdue = false;
    if (forceOverdue) isReallyOverdue = true; 
    else if (priority === 'urgent' && type !== 'calving') isReallyOverdue = true;

    list.push({
        id: taskId, animalId: animal.id, tag: animal.tag, title: title,
        dueDate: dueDate, sortDate: sortDate, priority: priority, type: type,
        isDone: !!doneLog, doneDate: doneLog ? doneLog.completedAt.toDate() : null,
        logId: doneLog ? doneLog.logId : null, insemDate: insemDate, calvDate: calvDate,
        isReallyOverdue: isReallyOverdue
    });
}

function renderTasks(tasks) {
    const container = document.getElementById('tasksContainer');
    container.innerHTML = '';
    const today = new Date(); today.setHours(0,0,0,0);
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1); 
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    
    let filtered = tasks;

    if (currentTaskFilter === 'done') filtered = tasks.filter(t => t.isDone);
    else if (currentTaskFilter === 'todo') filtered = tasks.filter(t => !t.isDone && !t.isReallyOverdue);
    else if (currentTaskFilter === 'overdue') filtered = tasks.filter(t => !t.isDone && t.isReallyOverdue);
    else if (currentTaskFilter === 'month') {
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    // DODANO: && t.dueDate >= today (wyklucza stare zadania z widoku miesiąca)
    filtered = tasks.filter(t => !t.isDone && t.dueDate >= today && t.dueDate >= startOfMonth && t.dueDate <= endOfMonth);
}

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
    const counts = {}; const types = new Set(['all']);
    allTasks.forEach(t => { if(!t.isDone && !t.isReallyOverdue) { types.add(t.type); counts[t.type] = (counts[t.type] || 0) + 1; } });
    const labels = { 'all': 'Wszystkie', 'usg': 'USG', 'heat': 'Ruja', 'dry': 'Zasuszenie', 'rovac': 'Rovac', 'kexxtone': 'Kexxtone', 'calving': 'Wycielenia', 'sync': 'Synchronizacja' };
    const typesToShow = Array.from(types); if(typesToShow.length === 0 && currentTypeFilter === 'all') typesToShow.push('all');
    typesToShow.forEach(type => {
        let label = labels[type];
        if (!label && type.startsWith('custom_')) { const idx = parseInt(type.split('_')[1]); if (userSettings.customRules[idx]) label = userSettings.customRules[idx].label; else label = 'Własne'; }
        if (!label) label = type; const count = counts[type] || 0; if (type !== 'all' && count > 0) label += ` (${count})`;
        const btn = document.createElement('button'); btn.className = `filter-chip ${currentTypeFilter === type ? 'active' : ''}`; btn.textContent = label; btn.onclick = () => { currentTypeFilter = type; generateAndRenderTasks(); }; container.appendChild(btn);
    });
}

// --- CONFIRM, WYCIELENIE ---

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
    
    // Pobieramy aktualne dane zwierzęcia, aby nie nadpisać historii
    const animal = myHerd.find(a => a.id === taskData.animalId);
    let historyCalving = animal.historyCalving || [];
    
    // Dodajemy nową datę do tablicy historii
    historyCalving.push({
        date: dateStr,
        note: isAuto ? "Automatyczne potwierdzenie" : "Ręczne potwierdzenie"
    });

    saveTaskLog(taskData, `Wycielenie: ${dateStr} ${isAuto ? '(Automat)' : ''}`);

    db.collection('animals').doc(taskData.animalId).update({
        lastCalving: dateStr,
        historyCalving: historyCalving, // ZAPISUJEMY HISTORIĘ
        lastInsemination: null,
        semen: null,
        isPregnantConfirmed: false,
        usgStatus: 'pending',
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

function openAnimalCard(id) {
    const animal = myHerd.find(a => a.id === id);
    if (!animal) return;
    currentEditingAnimalId = id;
    
    document.getElementById('viewMode').classList.remove('hidden');
    document.getElementById('editMode').classList.add('hidden');

    document.getElementById('cardTag').textContent = animal.tag;
    document.getElementById('cardDob').textContent = animal.dob;
    // Punkt 7: Wyświetlanie typu zwierzęcia
    const cardTypeEl = document.getElementById('cardType');
    if(cardTypeEl) cardTypeEl.textContent = animal.type;

    // Punkt 11: Historia wycieleń
    const calvHistDiv = document.getElementById('cardCalvingHistory');
    if(calvHistDiv) {
        calvHistDiv.innerHTML = '<h4 style="margin-top:10px; color:#2e7d32;">Historia wycieleń:</h4>';
        const ch = animal.historyCalving || [];
        if(ch.length === 0) calvHistDiv.innerHTML += '<small style="color:#999;">Brak danych</small>';
        [...ch].reverse().forEach(c => {
            calvHistDiv.innerHTML += `<div style="font-size:12px; padding:5px 0; border-bottom:1px solid #eee;">🍼 Data: <b>${c.date}</b> <small>(${c.note || ''})</small></div>`;
        });
    }
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

    document.getElementById('editTag').value = animal.tag;
    document.getElementById('editDob').value = animal.dob;
    document.getElementById('editLastCalving').value = animal.lastCalving || '';
    document.getElementById('editLastInsem').value = animal.lastInsemination || '';

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

    // Usunięto powtórną deklarację const calvHistDiv, bo była wyżej w tej samej funkcji
    const calvDiv = document.getElementById('cardCalvingHistory'); 
    if(calvDiv) {
        calvDiv.innerHTML = '<h4 style="margin-top:15px; color:#2e7d32;">Historia wycieleń:</h4>';
        const ch = animal.historyCalving || [];
        if(ch.length === 0) {
            calvDiv.innerHTML += '<div style="font-size:12px; color:#999;">Brak zarejestrowanych wycieleń.</div>';
        } else {
            [...ch].reverse().forEach(c => {
                calvDiv.innerHTML += `<div style="font-size:12px; padding:5px 0; border-bottom:1px solid #eee;">
                    <span>🍼 Data: <b>${c.date}</b></span>
                </div>`;
            });
        }
    }
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

// --- ZARZĄDZANIE MODALAMI ---

function openAnimalModal() {
    document.getElementById('animalForm').reset();
    document.getElementById('animalModal').style.display = 'flex';
    document.getElementById('cowFields').classList.remove('hidden');
    document.getElementById('inpType').value = 'krowa';
}

function openInsemModal() { document.getElementById('insemModal').style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }

function setupModals() {
    document.getElementById('inpType').addEventListener('change', (e) => {
        const type = e.target.value;
        if(type === 'krowa' || type === 'jalowka') {
            document.getElementById('cowFields').classList.remove('hidden');
        } else {
            document.getElementById('cowFields').classList.add('hidden');
        }
    });

    document.getElementById('insemForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const tagVal = document.getElementById('insemTagInput').value; 
        const date = document.getElementById('insemDate').value;
        const bull = document.getElementById('insemBull').value;
        const note = document.getElementById('insemNote').value;

        const animal = myHerd.find(a => a.tag === tagVal);
        if(!animal) {
            alert("Nie znaleziono zwierzęcia! Sprawdź listę.");
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
        }).catch(err => alert("Błąd: " + err.message));
    });

    document.getElementById('animalForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const type = document.getElementById('inpType').value;
        const tag = document.getElementById('inpTag').value;
        const dob = document.getElementById('inpDob').value;
        const location = document.getElementById('inpLocation')?.value || '';
        const lastCalving = document.getElementById('inpLastCalving').value || null;
        const lastInsem = document.getElementById('inpLastInsem').value || null;
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
            location: location, // DODAJ TO
            lastInsemination: lastInsem, 
            semen, historyInsemination, isPregnantConfirmed, usgStatus,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }).then(() => {
            alert("Dodano zwierzę!");
            closeModal('animalModal');
        }).catch(err => alert("Błąd: " + err.message));
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

    ['usg', 'heat', 'sync', 'dry', 'rovac', 'kexxtone'].forEach(k => createInput(k, userSettings[k]));

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
                <button class="btn-danger" style="width: 34px; height: 34px; display: flex; align-items: center; justify-content: center; margin-left: 5px; border-radius: 6px; padding: 0;" onclick="removeCustomRule(${idx})">
                    <i class="bi bi-trash"></i>
                </button>
            </div>
        `;
        list.appendChild(div);
    });
}

function saveConfiguration(fromDOM = true) {
    if(!currentUser || !currentUser.id) {
        alert("Błąd: Brak ID użytkownika.");
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

    return db.collection('konfiguracja').doc(currentUser.id).collection('settings').doc('tasks').set(userSettings, {merge: true});
}

document.getElementById('customTaskForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('newCfgName').value;
    const base = document.getElementById('newCfgBase').value;
    const s = parseInt(document.getElementById('newCfgStart').value);
    const end = parseInt(document.getElementById('newCfgEnd').value);

    userSettings.customRules.push({ label: name, base: base, start: s, end: end, enabled: true });
    
    saveConfiguration(false).then(() => {
        alert(`Dodano: ${name}`);
        renderConfig();
        document.getElementById('customTaskForm').reset();
    }).catch(err => alert("Błąd zapisu: " + err.message));
});

function removeCustomRule(idx) {
    if(!confirm("Usunąć?")) return;
    userSettings.customRules.splice(idx, 1);
    saveConfiguration(false).then(() => renderConfig());
}

function resetConfiguration() {
    if(confirm("Przywrócić domyślne?")) {
        userSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
        saveConfiguration(false).then(() => renderConfig());
    }
}

// --- HELPERY I NAV ---

function setDateInput(id, deltaDays) {
    const el = document.getElementById(id);
    const d = new Date();
    d.setDate(d.getDate() + deltaDays);
    el.valueAsDate = d;
}

function switchTaskFilter(mode) {
    currentTaskFilter = mode;
    document.querySelectorAll('.sub-tab').forEach(b => {
        b.classList.remove('active');
        // Dodatkowe sprawdzenie, by podświetlić właściwy guzik
        if(b.getAttribute('onclick')?.includes(mode)) b.classList.add('active');
    });
    generateAndRenderTasks();
}

function filterHerd(type) {
    switchSection('section-herd');
    renderHerdList(type);
}

function updateDashboardStats() {
    document.getElementById('cntCows').textContent = myHerd.filter(a => a.type === 'krowa').length;
    document.getElementById('cntHeifers').textContent = myHerd.filter(a => a.type === 'jalowka').length;
    document.getElementById('cntBulls').textContent = myHerd.filter(a => a.type === 'byk').length;
}

function setupNavigation() {
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', () => {
            switchSection(btn.dataset.target);
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
    const navBtn = document.querySelector(`.nav-item[data-target="${id}"]`); 
    if(navBtn) navBtn.classList.add('active'); 
    // Nie ładujemy automatycznie - użytkownik musi kliknąć przycisk
}

function addDays(date, days) { const r = new Date(date); r.setDate(r.getDate() + days); return r; }
function changeMonth(delta) { currentCalDate.setMonth(currentCalDate.getMonth() + delta); renderCalendar(currentCalDate); }
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
function showListModal(title, animals) {
    const modal = document.getElementById('listModal');
    const contentEl = document.getElementById('listModalContent');
    document.getElementById('listModalTitle').textContent = title;
    contentEl.innerHTML = '';

    animals.forEach(a => {
        const div = document.createElement('div');
        div.className = 'card';
        div.style.padding = '10px';
        div.style.marginBottom = '10px';

        // Logika identyczna jak w renderHerdList (Stado)
        let detailsHtml = '';
        const today = new Date();
        if (a.type === 'krowa' || a.type === 'jalowka') {
            const ins = a.lastInsemination || '-';
            let calv = '-';
            if (a.lastInsemination) {
                const est = addDays(new Date(a.lastInsemination), userSettings.gestation || 280);
                calv = est.toLocaleDateString('pl-PL');
            }
            detailsHtml = `
                <div style="font-size:11px; color:#555; margin-top:5px; display:grid; grid-template-columns: 1fr 1fr; gap:5px;">
                    <span>💉 Ost. zac: <b>${ins}</b></span>
                    <span>👶 Termin: <b>${calv}</b></span>
                </div>`;
        }

        div.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <strong style="color:#2e7d32; font-size:16px;">${a.tag}</strong>
                <span class="badge" style="background:#eee; color:#333;">${a.type}</span>
            </div>
            ${detailsHtml}`;

        div.onclick = () => {
            closeModal('listModal'); // Najpierw zamykamy listę z wykresu
            openAnimalCard(a.id);    // Potem otwieramy kartę krowy
        };
        contentEl.appendChild(div);
    });
    modal.style.display = 'flex';
}
function updateDashboardStats() { document.getElementById('cntCows').textContent = myHerd.filter(a => a.type === 'krowa').length; document.getElementById('cntHeifers').textContent = myHerd.filter(a => a.type === 'jalowka').length; document.getElementById('cntBulls').textContent = myHerd.filter(a => a.type === 'byk').length; }
function setupNavigation() { document.querySelectorAll('.nav-item').forEach(btn => { btn.addEventListener('click', () => { switchSection(btn.dataset.target); }); }); document.getElementById('logoutBtn').addEventListener('click', () => { auth.signOut(); }); }
function switchSection(id) { 
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active')); 
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active')); 
    document.getElementById(id).classList.add('active'); 
    const navBtn = document.querySelector(`.nav-item[data-target="${id}"]`); 
    if(navBtn) navBtn.classList.add('active'); 
    if(id === 'section-treatments') { /* Nie ładuj auto */ }
}
function toggleHerdFilter(filter) {
    const idx = activeHerdFilters.indexOf(filter);
    if (idx > -1) activeHerdFilters.splice(idx, 1);
    else activeHerdFilters.push(filter);
    
    // Wizualna zmiana koloru przycisku
    const btn = document.getElementById('f-' + filter);
    if(btn) btn.classList.toggle('active');
    
    renderHerdList(); 
}
// --- FUNKCJE RENDERUJĄCE (NAPRAWA BŁĘDÓW) ---

function renderHerdList() {
    const list = document.getElementById('herdList');
    if (!list) return;
    list.innerHTML = '';

    // Tworzymy kopię stada do filtrowania i sortowania
    let filtered = [...myHerd];

    // --- PUNKT 13: SORTOWANIE DOMYŚLNE ---
    // Hierarchia: Puste -> Do USG -> Cielne -> Jałówki niekryte -> Byki/Inne
    filtered.sort((a, b) => {
        const getPriority = (s) => {
            if (s.usgStatus === 'negative' || s.usgStatus === 'unknown') return 1; // Niecielne (Puste)
            if (s.usgStatus === 'pending' || (s.lastInsemination && !s.isPregnantConfirmed)) return 2; // Do USG / Badania
            if (s.isPregnantConfirmed) return 3; // Cielne potwierdzone
            if (s.type === 'jalowka' && !s.lastInsemination) return 4; // Jałówki jeszcze nie kryte
            return 5; // Byki i pozostałe
        };
        return getPriority(a) - getPriority(b);
    });

    // --- PUNKT 12: OBSŁUGA WIELU FILTRÓW JEDNOCZEŚNIE ---
    if (activeHerdFilters.length > 0) {
        filtered = filtered.filter(a => {
            // Sprawdzamy statusy cielności
            if (activeHerdFilters.includes('cielne') && a.isPregnantConfirmed) return true;
            if (activeHerdFilters.includes('puste') && (s.usgStatus === 'negative' || s.usgStatus === 'unknown')) return true;
            if (activeHerdFilters.includes('usg') && a.usgStatus === 'pending') return true;
            
            // Sprawdzamy typy zwierząt
            if (activeHerdFilters.includes(a.type)) return true;
            
            return false;
        });
    }

    // Obsługa wyszukiwarki (Search Bar)
    const searchInput = document.getElementById('herdSearch');
    const search = searchInput ? searchInput.value.toLowerCase() : '';
    if (search) {
        filtered = filtered.filter(a => a.tag.toLowerCase().includes(search));
    }

    if (filtered.length === 0) {
        list.innerHTML = '<div style="text-align:center; padding:20px; color:#999;">Brak zwierząt pasujących do filtrów.</div>';
        return;
    }

    const today = new Date();

    filtered.forEach(a => {
        let detailsHtml = '';
        let statusIcon = '';
        
        if (a.type === 'krowa' || a.type === 'jalowka') {
            if (a.isPregnantConfirmed) statusIcon = '✅ Cielna'; 
            else if (a.usgStatus === 'negative' || a.usgStatus === 'unknown') statusIcon = '❌ Pusta'; 
            else if (a.lastInsemination) statusIcon = '❓ Do badania'; 
            else statusIcon = '⚪ Oczekiwanie';

            const ins = a.lastInsemination ? a.lastInsemination : '-';
            let calv = '-'; 
            let dim = '-';

            if (a.lastInsemination) {
                const est = addDays(new Date(a.lastInsemination), userSettings.gestation || 280);
                calv = est.toLocaleDateString('pl-PL');
            }
            if (a.lastCalving) {
                const days = Math.floor((today - new Date(a.lastCalving)) / (1000 * 60 * 60 * 24));
                dim = `${days} dni`;
            }
            detailsHtml = `<div style="font-size:11px; color:#555; margin-top:5px; display:grid; grid-template-columns: 1fr 1fr; gap:5px;">
                <span>💉 Ost. zac: <b>${ins}</b></span>
                <span>👶 Termin: <b>${calv}</b></span>
                <span>📊 Laktacja: <b>${dim}</b></span>
                <span style="font-weight:bold; color:${a.isPregnantConfirmed?'green':'#555'}">${statusIcon}</span>
            </div>`;
        }

        const div = document.createElement('div');
        div.className = 'card';
        div.style.padding = '10px';
        div.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <strong style="color:#2e7d32; font-size:16px;">${a.tag}</strong>
                <span class="badge" style="background:#eee; color:#333; padding:2px 8px; border-radius:10px; font-size:10px;">${a.type}</span>
            </div>
            ${detailsHtml}
        `;
        div.onclick = () => openAnimalCard(a.id);
        list.appendChild(div);
    });
}

function renderLactationChart() {
    const canvas = document.getElementById('lactationChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    const buckets = [0, 0, 0, 0, 0, 0, 0];
    // Nowa tablica przechowująca listy zwierząt dla każdego słupka
    const bucketAnimals = [[], [], [], [], [], [], []];
    const bucketLabels = ['0-2m', '2-4m', '4-6m', '6-8m', '8-10m', '10-12m', '>12m'];
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
            // Dodajemy obiekt krowy do odpowiedniego kubełka
            bucketAnimals[idx].push(a);
        }
    });

    if (window.myChart) window.myChart.destroy();
    
    window.myChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: bucketLabels,
            datasets: [{
                label: 'Liczba krów',
                data: buckets,
                backgroundColor: '#2e7d32',
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } },
            // Dodana obsługa kliknięcia w słupek
            onClick: (evt, activeEls) => {
                if (activeEls.length > 0) {
                    const idx = activeEls[0].index;
                    const label = bucketLabels[idx];
                    const animals = bucketAnimals[idx];
                    // Wywołanie funkcji wyświetlającej modal z listą krów
                    showListModal(`Krowy w laktacji: ${label}`, animals);
                }
            }
        }
    });
}
