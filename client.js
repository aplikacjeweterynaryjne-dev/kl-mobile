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
let selectedTaskIds = []; // Przechowuje zaznaczone zadania
window.showAllTasks = false;
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
function toggleEditFields() {
    const type = document.getElementById('editType').value;
    const isBull = (type === 'byk');
    
    // Pola do ukrycia dla byka
    const fieldsToHide = [
        'editLastCalving', 'editLastInsem', 'editSemen', 
        'editPregStatus', 'editIsDriedOff'
    ];
    
    fieldsToHide.forEach(id => {
        const el = document.getElementById(id);
        if(el) {
            // Ukrywamy cały rząd (form-row), czyli rodzica inputa
            el.closest('.form-row').style.display = isBull ? 'none' : 'flex'; // lub 'block'
        }
    });
}
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
// --- NOWA LOGIKA STATUSÓW ---
function getDetailedStatus(a) {
    const today = new Date();
    today.setHours(0,0,0,0);
    const calvDate = a.lastCalving ? new Date(a.lastCalving) : null;
    const insDate = a.lastInsemination ? new Date(a.lastInsemination) : null;
    const diffCalv = calvDate ? Math.floor((today - calvDate) / (1000 * 60 * 60 * 24)) : null;

    // 1. ZASUSZONA (Najwyższy priorytet wizualny)
    // Jeśli krowa jest zasuszona, wyświetlamy to nawet jeśli jest cielna.
    if (a.isDriedOff) return { text: '❄️ Zasuszona', color: '#7f8c8d', category: 'zasuszone' };

    // 2. Cielna (Potwierdzona)
    if (a.isPregnantConfirmed) return { text: '✅ Cielna', color: 'green', category: 'cielne' };
    
    // 3. Logika po inseminacji (ale jeszcze nie potwierdzona)
    if (insDate) {
        const diffInsem = Math.floor((today - insDate) / (1000 * 60 * 60 * 24));
        
        if (a.usgStatus === 'negative') return { text: '❌ Pusta (po USG)', color: '#c0392b', category: 'puste' };

        // ODLICZANIE DO USG
        const usgStart = (userSettings && userSettings.usg) ? Math.min(userSettings.usg.start, userSettings.usg.end) : 40;

        if (diffInsem < usgStart) {
            const daysLeft = usgStart - diffInsem;
            return { text: `⏳ Do USG za ${daysLeft} dni`, color: '#9b59b6', category: 'inne' };
        }

        return { text: '❓ Do badania USG', color: '#f39c12', category: 'usg' };
    }

    // 4. Logika po wycieleniu (bez inseminacji)
    if (calvDate) {
        // Tu jest status "świeżej" krowy
        if (diffCalv <= 60) return { text: '🍼 Wycielona < 60 dni', color: '#2980b9', category: 'puste' };
        if (diffCalv > 365) return { text: '⚠️ Niecielna > 1 rok', color: '#e74c3c', category: 'puste' };
    }

    // 5. Jałówki i pozostałe puste
    if (a.type === 'jalowka' && !insDate) return { text: '⚪ Jałówka (niekryta)', color: '#7f8c8d', category: 'puste' };

    return { text: '⚪ Pusta', color: '#7f8c8d', category: 'puste' };
}

function generateAndRenderTasks() {
    const today = new Date();
    today.setHours(0,0,0,0);
    let generatedTasks = [];

    myHerd.forEach(animal => {
        
       // =================================================================
        // 1. ŚCIEŻKA SZYBKA DLA BYKÓW (Poprawiona logika)
        // =================================================================
        if (animal.type === 'byk') {
            if (!animal.dob) return; 

            const dob = new Date(animal.dob);
            // 1 miesiąc = średnio 30.44 dnia
            const ageMonths = (today - dob) / (1000 * 60 * 60 * 24 * 30.44);

            // WIDOK 1: Od 20 do 24 miesiąca (Normalne przypomnienie)
            if (ageMonths >= 20 && ageMonths < 24) {
                const taskId20 = `${animal.id}_sell_20_24`;
                if (!completedTasks.some(t => t.taskId === taskId20)) {
                    generatedTasks.push({
                        id: taskId20, animalId: animal.id, tag: animal.tag, 
                        title: 'Sprzedaż byka (20-24 msc)',
                        dueDate: today, 
                        sortDate: today, priority: 'warning', type: 'sell_20_24',
                        isDone: false, logId: null, insemDate: null, calvDate: null, 
                        isReallyOverdue: false
                    });
                }
            }
            // WIDOK 2: Powyżej 24 miesiąca (PILNE)
            // Wyświetli się TYLKO jeśli byk nadal jest w stadzie (czyli nie został sprzedany wcześniej)
            else if (ageMonths >= 24) { 
                const taskId24 = `${animal.id}_sell_24_30`;
                // Generujemy to zadanie, nawet jeśli poprzednie (20-24) było wykonane, 
                // bo skoro byk tu dalej jest i ma >24msc, to znaczy że trzeba go sprzedać.
                if (!completedTasks.some(t => t.taskId === taskId24)) {
                    generatedTasks.push({
                        id: taskId24, animalId: animal.id, tag: animal.tag, 
                        title: 'PILNE: Sprzedaż byka (> 24 msc)',
                        dueDate: today,
                        sortDate: today, priority: 'urgent', type: 'sell_24_30',
                        isDone: false, logId: null, insemDate: null, calvDate: null, 
                        isReallyOverdue: false 
                    });
                }
            }
            
            return; // Kończymy dla byka
        }
        // =================================================================


        // 2. USTALANIE DATY WYCIELENIA (Logika dla Krów/Jałówek)
        const insDate = animal.lastInsemination ? new Date(animal.lastInsemination) : null;
        
        let calvingDate = insDate ? addDays(insDate, userSettings.gestation || 280) : null;

        const daysSinceInsem = insDate ? Math.floor((today - insDate) / (1000 * 60 * 60 * 24)) : 0;
        const daysToCalving = calvingDate ? Math.floor((calvingDate - today) / (1000 * 60 * 60 * 24)) : 999;

        // --- AUTOMATYKA STATUSÓW ---
        if (animal.usgStatus === 'pending' && daysSinceInsem > (userSettings.usg.end || 60)) {
            db.collection('animals').doc(animal.id).update({ isPregnantConfirmed: true, usgStatus: 'positive' });
        }
        
        const dryDeadline = Math.min(userSettings.dry.start, userSettings.dry.end);
        if (animal.isPregnantConfirmed && !animal.isDriedOff && daysToCalving < dryDeadline) {
            db.collection('animals').doc(animal.id).update({ isDriedOff: true });
        }

        if (animal.isPregnantConfirmed && calvingDate && daysToCalving < -7) {
            const taskId = `${animal.id}_calving_${calvingDate.toISOString().split('T')[0]}`;
            if (!completedTasks.some(t => t.taskId === taskId)) {
                confirmTaskCalving({ animalId: animal.id, taskId: taskId }, calvingDate, true);
            }
        }

        // --- GENEROWANIE ZADAŃ WIZUALNYCH (Dla krów) ---

        // Synchronizacja
        if (animal.type === 'krowa' && animal.lastCalving) {
            const lastCalv = new Date(animal.lastCalving);
            const dim = Math.floor((today - lastCalv) / (1000 * 60 * 60 * 24));
            if (dim > 60 && dim < 365 && !animal.isPregnantConfirmed && animal.usgStatus !== 'pending') {
                addTask(generatedTasks, animal, 'Wykonaj synchronizację', today, today, 'warning', 'sync', null, lastCalv);
            }
        }

        // FILTR PRZEJŚCIA (Teraz bezpieczny, bo byki są obsługiwane wyżej)
        if (animal.usgStatus === 'negative' && !animal.isPregnantConfirmed) return;
        if (!calvingDate && !insDate) return;

        // USG i Ruja
        if (!animal.isPregnantConfirmed && insDate) {
            checkRuleAndAddTask(generatedTasks, animal, userSettings.usg, daysSinceInsem, insDate, 'usg', calvingDate);
            checkRuleAndAddTask(generatedTasks, animal, userSettings.heat, daysSinceInsem, insDate, 'heat', calvingDate);
        }

        // Zasuszenie / Profilaktyka
        if (calvingDate) {
            if (animal.type === 'krowa') {
                checkRuleAndAddTask(generatedTasks, animal, userSettings.dry, daysToCalving, calvingDate, 'dry', calvingDate, true);
            }
            checkRuleAndAddTask(generatedTasks, animal, userSettings.rovac, daysToCalving, calvingDate, 'rovac', calvingDate, true);
            checkRuleAndAddTask(generatedTasks, animal, userSettings.kexxtone, daysToCalving, calvingDate, 'kexxtone', calvingDate, true);
        }

        // Zadania własne
        userSettings.customRules.forEach((rule, idx) => {
            if (rule.base === 'insem' && insDate) {
                checkRuleAndAddTask(generatedTasks, animal, rule, daysSinceInsem, insDate, `custom_${idx}`, calvingDate);
            } else if (calvingDate) {
                checkRuleAndAddTask(generatedTasks, animal, rule, daysToCalving, calvingDate, `custom_${idx}`, calvingDate, true);
            }
        });

        // Wycielenie (Wizualne)
        if (calvingDate && daysToCalving <= 14 && daysToCalving >= -7) {
            const calvTaskId = `${animal.id}_calving_${calvingDate.toISOString().split('T')[0]}`;
            if (!completedTasks.some(t => t.taskId === calvTaskId)) {
                let priority = (daysToCalving <= 5 && daysToCalving >= -5) ? 'urgent' : 'warning';
                addTask(generatedTasks, animal, 'Spodziewane Wycielenie', calvingDate, calvingDate, priority, 'calving', insDate, calvingDate, (daysToCalving < 0));
            }
        }
    });

    window.myAllTasksGlobal = generatedTasks;
    renderTasks(generatedTasks);
}

function renderTasks(allTasks) {
    const container = document.getElementById('tasksContainer');
    if (!container) return;
    container.innerHTML = '';
    const today = new Date(); today.setHours(0,0,0,0);
    
    // Filtrowanie zadań
    let filtered = allTasks.filter(t => {
        const today = new Date();
        today.setHours(0,0,0,0);
        
        // Obliczamy ile dni minęło od terminu (dueDate)
        const diffMs = today - t.dueDate;
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        // Automatyczne usuwanie starych zadań (powyżej 14 dni po terminie)
        if (!t.isDone && t.isReallyOverdue && diffDays > 14) return false;

        // --- FILTROWANIE ZAKŁADEK ---
        if (currentTaskFilter === 'done') return t.isDone;
        
        if (currentTaskFilter === 'todo') {
            return !t.isDone && !t.isReallyOverdue;
        }
        
        if (currentTaskFilter === 'overdue') {
            return !t.isDone && t.isReallyOverdue;
        }
        
     // 4. TEN MIESIĄC (Wersja Poprawiona - Sztywna)
        if (currentTaskFilter === 'month') {
            const currentMonth = today.getMonth();
            const currentYear = today.getFullYear();
            const taskMonth = t.dueDate.getMonth();
            const taskYear = t.dueDate.getFullYear();
            
            // Pokaż TYLKO jeśli termin (dueDate) wypada w bieżącym miesiącu kalendarzowym
            const isThisMonth = (taskMonth === currentMonth && taskYear === currentYear);
            return !t.isDone && isThisMonth;
        }

        return true;
    });

    // Filtrowanie po typie (chipy na górze)
    if (currentTypeFilter !== 'all') {
        filtered = filtered.filter(t => t.type === currentTypeFilter);
    }

    filtered.sort((a, b) => a.dueDate - b.dueDate);

    // Obsługa limitu 5 zadań dla widoku "Do zrobienia"
    const LIMIT = 5;
    const showAll = window.showAllTasks || false;
    // Limitujemy tylko w zakładce 'todo' jeśli nie kliknięto "Pokaż wszystkie"
    const visibleTasks = (currentTaskFilter === 'todo' && !showAll) ? filtered.slice(0, LIMIT) : filtered;

    // Renderowanie kafelków
    visibleTasks.forEach(t => {
        const div = document.createElement('div');
        div.className = `task-item ${t.priority} ${t.isDone ? 'done' : ''}`;
        
        const dueStr = t.dueDate.toLocaleDateString('pl-PL');
        const insemStr = t.insemDate ? (new Date(t.insemDate).toLocaleDateString('pl-PL')) : '-';
        const estCalvStr = t.calvDate ? (new Date(t.calvDate).toLocaleDateString('pl-PL')) : '-';
        const dateColor = t.isReallyOverdue ? 'red' : (t.priority === 'urgent' ? '#e67e22' : '#333'); 

        // Checkbox do masowego wyboru (po lewej)
        const selectBox = `<input type="checkbox" class="mass-select-cb" 
            style="margin-right: 10px; transform: scale(1.3);" 
            value="${t.id}" 
            onchange="toggleTaskSelection('${t.id}')"
            ${selectedTaskIds.includes(t.id) ? 'checked' : ''}>`;

        div.innerHTML = `
            <div style="display:flex; align-items:center;">
                ${!t.isDone ? selectBox : ''} 
                <div style="flex: 1;">
                    <div style="font-size:15px; font-weight:bold; color:#333;">${t.title}</div>
                    <div style="font-size: 11px; color: #777; margin: 4px 0; line-height: 1.4;">
                        Termin: <b style="color:${dateColor}">${dueStr}</b><br>
                        💉 Krycie: <b>${insemStr}</b> | 🍼 Przew. poród: <b>${estCalvStr}</b>
                    </div>
                    <div class="task-animal-tag" onclick="openAnimalCard('${t.animalId}')">${t.tag}</div>
                </div>
            </div>
            <div class="task-check-wrapper">
                ${t.isDone 
                    ? `<button class="btn" style="padding:5px 10px; font-size:11px; background:#ddd;" onclick="undoTask('${t.logId}')">Cofnij</button>`
                    : `<input type="checkbox" style="transform:scale(1.5); border: 2px solid #2980b9;" onclick="initiateTaskCompletion('${t.id}', '${t.type}', '${t.animalId}', '${t.dueDate.toISOString()}')">`
                }
            </div>
        `;
        container.appendChild(div);
    });

    // Przycisk "Pokaż wszystkie" tylko dla zakładki 'todo'
    if (currentTaskFilter === 'todo' && filtered.length > LIMIT) {
        const btnRow = document.createElement('div');
        btnRow.style.textAlign = 'center';
        const btnLabel = showAll ? "ZWIŃ LISTĘ" : `POKAŻ WSZYSTKIE (${filtered.length})`;
        btnRow.innerHTML = `<button class="btn" style="background:#f0f4f8; color:var(--info); font-size:12px; padding:10px; width:100%; border:1px dashed var(--info); margin-top:10px;" 
            onclick="window.showAllTasks=${!showAll}; renderTasks(window.myAllTasksGlobal);">${btnLabel}</button>`;
        container.appendChild(btnRow);
    }

    if (filtered.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:20px; color:#999;">Brak zadań w tym widoku.</div>';
    }
    renderTaskTypeChips(allTasks);
}

function checkRuleAndAddTask(list, animal, rule, daysCounter, refDate, type, calvDate, isReverse = false) {
    if (!rule || !rule.enabled) return;
    
    // 1. Najpierw wyliczamy datę, żeby sprawdzić ID zadania
    const minVal = Math.min(rule.start, rule.end);
    const maxVal = Math.max(rule.start, rule.end);
    let dueDate = null;
    let isActive = false;
    let isOverdue = false;
    const today = new Date();
    today.setHours(0,0,0,0);

    if (isReverse) {
        dueDate = addDays(calvDate, -minVal); 
        if (daysCounter <= maxVal && daysCounter >= minVal) isActive = true;
        if (daysCounter < minVal) isOverdue = true;
    } else {
        dueDate = addDays(refDate, maxVal); 
        if (daysCounter >= minVal && daysCounter <= maxVal) isActive = true;
        if (daysCounter > maxVal) isOverdue = true;
    }

    // 2. Sprawdzamy czy zadanie zostało już wykonane (szukamy w logach)
    const dateStr = dueDate.toISOString().split('T')[0];
    const taskId = `${animal.id}_${type}_${dateStr}`;
    const isAlreadyDone = completedTasks.some(t => t.taskId === taskId);

    // 3. POPRAWKA LOGIKI:
    // Blokujemy wyświetlanie "do zrobienia" jeśli krowa ma już status (np. isDriedOff), 
    // ALE pozwalamy wyświetlić zadanie jeśli jest ono w "completedTasks" (żeby było w zakładce Wykonane).
    if (isReverse && animal.isDriedOff && type === 'dry' && !isAlreadyDone) return;

    // Reszta bez zmian
    const actualInsemDate = animal.lastInsemination ? new Date(animal.lastInsemination) : null;

    if (isActive || isAlreadyDone) { // Dodano || isAlreadyDone, żeby wpadło do listy wykonanych
        addTask(list, animal, rule.label, dueDate, today, 'warning', type, actualInsemDate, calvDate, false);
    } else if (isOverdue) {
        const diffMs = today - dueDate;
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        if (diffDays <= 14) {
            addTask(list, animal, rule.label, dueDate, today, 'urgent', type, actualInsemDate, calvDate, true);
        }
    }
}
function addTask(list, animal, title, dueDate, sortDate, priority, type, insemDate, calvDate, forceOverdue = false) {
    const dateStr = dueDate.toISOString().split('T')[0];
    const taskId = `${animal.id}_${type}_${dateStr}`; 
    const doneLog = completedTasks.find(t => t.taskId === taskId);
    const isDone = !!doneLog;
    
    // Zapewniamy, że insemDate i calvDate to obiekty Date dla renderera
    const finalInsem = insemDate ? new Date(insemDate) : null;
    const finalCalv = calvDate ? new Date(calvDate) : null;

    list.push({
        id: taskId, animalId: animal.id, tag: animal.tag, title: title,
        dueDate: dueDate, sortDate: sortDate, priority: priority, type: type,
        isDone: isDone, logId: isDone ? doneLog.logId : null, 
        insemDate: finalInsem, 
        calvDate: finalCalv,
        isReallyOverdue: forceOverdue
    });
}

function renderTaskTypeChips(allTasks) {
    const container = document.getElementById('taskTypeChips');
    if (!container) return;
    container.innerHTML = '';
    const counts = {}; 
    const types = new Set(['all']);
    const today = new Date(); today.setHours(0,0,0,0);
    const limitDate = addDays(today, -14);

    allTasks.forEach(t => {
        // Logika widoczności taka sama jak w renderTasks
        let visibleInTab = false;
        if (currentTaskFilter === 'todo' && !t.isDone && !t.isReallyOverdue) visibleInTab = true;
        else if (currentTaskFilter === 'overdue' && !t.isDone && t.isReallyOverdue) visibleInTab = true;
        else if (currentTaskFilter === 'done' && t.isDone) visibleInTab = true;
        else if (currentTaskFilter === 'month' && !t.isDone) visibleInTab = true;

        if (visibleInTab) {
            types.add(t.type);
            counts[t.type] = (counts[t.type] || 0) + 1;
        }
    });

   const labels = { 
        'all': 'Wszystkie', 'usg': 'USG', 'heat': 'Ruja', 
        'dry': 'Zasuszenie', 'rovac': 'Rovac', 'kexxtone': 'Kexxtone', 
        'calving': 'Wycielenia', 'sync': 'Synchronizacja',
        // NOWE WPISY:
        'sell_20_24': 'Sprzedaż (20-24m)',
        'sell_24_30': 'Sprzedaż (24-30m)'
    };
    
    Array.from(types).forEach(type => {
        let label = labels[type];
        
        // --- POPRAWKA: Pobieranie nazwy dla zadań własnych ---
        if (!label && type.startsWith('custom_')) {
            const idx = parseInt(type.split('_')[1]);
            if (userSettings.customRules && userSettings.customRules[idx]) {
                label = userSettings.customRules[idx].label;
            }
        }
        // Fallback, gdyby coś poszło nie tak
        if (!label) label = type; 
        // -----------------------------------------------------

        const count = counts[type] || 0;
        const finalLabel = (type === 'all') ? label : `${label} (${count})`;
        
        const btn = document.createElement('button');
        btn.className = `filter-chip ${currentTypeFilter === type ? 'active' : ''}`;
        btn.textContent = finalLabel;
        btn.onclick = () => { currentTypeFilter = type; renderTasks(allTasks); };
        container.appendChild(btn);
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
    
    // 1. Obsługa Sprzedaży Byka (PRIORYTET)
    if (pendingTask.type === 'sell_20_24' || pendingTask.type === 'sell_24_30') {
        
        // Najpierw pytamy użytkownika (zanim cokolwiek zamkniemy)
        if (confirm("Czy sprzedałeś tego byka? \nKliknij OK, aby USUNĄĆ go trwale ze stada.\nKliknij Anuluj, aby tylko odhaczyć zadanie (byk zostanie).")) {
            
            // Użytkownik chce usunąć
            db.collection('animals').doc(pendingTask.animalId).delete()
              .then(() => {
                  alert("Byk został usunięty ze stada.");
                  // Zapisujemy log, że sprzedano
                  saveTaskLog(pendingTask, "Sprzedano i usunięto");
              })
              .catch(err => alert("Błąd usuwania: " + err.message));
        } else {
            // Użytkownik chce tylko odhaczyć zadanie
            saveTaskLog(pendingTask, "Wykonano (Pozostawiono w stadzie)");
        }
        
        closeModal('taskConfirmModal');
        return; 
    }

    // 2. Obsługa Zasuszenia
    if (pendingTask.type === 'dry') {
        db.collection('animals').doc(pendingTask.animalId).update({ isDriedOff: true });
        alert("Krowa została oznaczona jako zasuszona.");
    }

    // 3. Standardowe zadania (np. Rovac, Kexxtone)
    saveTaskLog(pendingTask, "Wykonano");
    closeModal('taskConfirmModal');
}

function confirmTaskUSG(isPregnant) {
    if(!pendingTask) return;
    
    const updateData = {
        isPregnantConfirmed: isPregnant,
        usgStatus: isPregnant ? 'positive' : 'negative'
    };

    db.collection('animals').doc(pendingTask.animalId).update(updateData).then(() => {
        if (!isPregnant) {
            // Komunikat informacyjny dla użytkownika
            alert("Sztuka pusta. Status zaktualizowany. Krowa kwalifikuje się do synchronizacji (Zadanie pojawi się na liście zadań).");
        }
        closeModal('taskConfirmModal');
    });

    saveTaskLog(pendingTask, isPregnant ? 'Pozytywny' : 'Negatywny');
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
        historyCalving: historyCalving, 
        lastInsemination: null,
        semen: null,
        isPregnantConfirmed: false,
        usgStatus: 'pending',
        type: 'krowa',
        
        // --- TO JEST NOWA LINIA, KTÓRA RESETUJE ZASUSZENIE ---
        isDriedOff: false 
        // -----------------------------------------------------
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
    if(!confirm("Cofnąć wykonanie zadania?")) return;
    
    // 1. Znajdujemy log w pamięci lokalnej, ZANIM go usuniemy
    // Musimy wiedzieć, jakiego zwierzęcia dotyczyło to zadanie
    const taskLog = completedTasks.find(t => t.logId === logId);
    
    // 2. Usuwamy z lokalnej tablicy (żeby zniknęło z ekranu)
    completedTasks = completedTasks.filter(t => t.logId !== logId);
    generateAndRenderTasks(); // Odświeżamy widok

    // 3. Usuwamy trwale z bazy danych (kolekcja logów)
    if (!logId.startsWith('temp_')) {
        db.collection('task_logs').doc(logId).delete();
    }

    // 4. NAPRAWIAMY STATUS ZWIERZĘCIA (To jest kluczowa nowość)
    if (taskLog && taskLog.animalId) {
        
        // Jeśli cofamy ZASUSZENIE -> odznaczamy 'isDriedOff' w bazie
        if (taskLog.taskType === 'dry') {
            db.collection('animals').doc(taskLog.animalId).update({ isDriedOff: false })
              .then(() => console.log("Cofnięto status zasuszenia w bazie."));
        }

        // Jeśli cofamy USG (które było pozytywne) -> odznaczamy cielność
        if (taskLog.taskType === 'usg' && taskLog.result === 'Pozytywny') {
             db.collection('animals').doc(taskLog.animalId).update({ 
                 isPregnantConfirmed: false, 
                 usgStatus: 'pending' // Ustawiamy na 'oczekujący', żeby znów wpadła do badania
             }).then(() => console.log("Cofnięto potwierdzenie cielności."));
        }
    }
}

// --- POPULACJA LIST (DATALISTS) ---

function populateLists() {
    const tagList = document.getElementById('tagList');
    const semenList = document.getElementById('semenList');
    if(!tagList || !semenList) return;

    tagList.innerHTML = '';
    semenList.innerHTML = '';
    
    const semenMap = new Set();

    myHerd.forEach(a => {
        // Lista kolczyków (dla inseminacji i wyboru matki)
        const opt = document.createElement('option');
        opt.value = a.tag;
        tagList.appendChild(opt);

        // Zbierz wszystkie użyte nazwy nasienia
        if(a.semen) semenMap.add(a.semen);
        if(a.fatherSemen) semenMap.add(a.fatherSemen);
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

    // Podstawowe dane
    document.getElementById('cardTag').textContent = animal.tag;
    document.getElementById('cardDob').textContent = animal.dob;
    document.getElementById('cardType').textContent = animal.type;
    
    // Pochodzenie i Lokalizacja
    if(document.getElementById('cardMother')) document.getElementById('cardMother').textContent = animal.motherTag || 'Brak danych';
    if(document.getElementById('cardFather')) document.getElementById('cardFather').textContent = animal.fatherSemen || 'Brak danych';
    if(document.getElementById('cardLocation')) document.getElementById('cardLocation').textContent = animal.location || 'Brak danych';

    // --- LOGIKA WIDOKU DLA RÓŻNYCH TYPÓW (Pkt 2) ---
    const isBull = (animal.type === 'byk');
    const cowSpecificElements = [
        'cardPregnancySectionJS', 'cardPregStatus', 'cardLastCalving', 
        'cardLastInsem', 'cardOffspring', 'cardHistory', 
        'cardCalvingHistory', 'cardDimStat'
    ];

    // Ukrywamy/Pokazujemy elementy typowe dla krów
    cowSpecificElements.forEach(elId => {
        const el = document.getElementById(elId);
        if(el) el.style.display = isBull ? 'none' : 'block';
    });

    // Sekcja specjalna dla Byka (Cele wiekowe) - wstrzykujemy dynamicznie
    let bullSection = document.getElementById('bullAgeSection');
    if (isBull) {
        if (!bullSection) {
            bullSection = document.createElement('div');
            bullSection.id = 'bullAgeSection';
            bullSection.style.cssText = "background:#fff3e0; padding:10px; border-radius:10px; margin:10px 0; border:1px solid #ffe0b2;";
            // Wstawiamy po dacie urodzenia
            document.getElementById('cardDob').parentNode.appendChild(bullSection);
        }
        bullSection.style.display = 'block';
        
        const dob = new Date(animal.dob);
        const d24 = new Date(dob); d24.setMonth(d24.getMonth() + 24);
        const d30 = new Date(dob); d30.setMonth(d30.getMonth() + 30);
        
        bullSection.innerHTML = `
            <strong>🎯 Cele hodowlane:</strong><br>
            24 mies: <b>${d24.toLocaleDateString()}</b><br>
            30 mies: <b>${d30.toLocaleDateString()}</b>
        `;
    } else {
        if(bullSection) bullSection.style.display = 'none';
        
        // Dla Krów/Jałówek wypełniamy standardowe dane (jeśli nie byk)
        if(document.getElementById('cardLastCalving')) document.getElementById('cardLastCalving').textContent = animal.lastCalving || '---';
        if(document.getElementById('cardLastInsem')) document.getElementById('cardLastInsem').textContent = animal.lastInsemination || '---';
        
        // Logika potomstwa i historii (bez zmian)...
        // (Tutaj wstawiamy Twój kod generowania potomstwa i historii inseminacji - ten sam co był)
        renderSubListsForCow(animal); // Wyniosłem to do małej funkcji pomocniczej niżej, żeby kod był czytelny
    }
    document.getElementById('editTag').value = animal.tag;
    document.getElementById('editDob').value = animal.dob;
    // NAPRAWA LOKALIZACJI
    document.getElementById('editLocation').value = animal.location || '';
    
    // Ustawienie typu w Select
    if(document.getElementById('editType')) {
        document.getElementById('editType').value = animal.type;
        toggleEditFields(); // Ukryj/Pokaż pola w zależności od typu
    }

    document.getElementById('editMother').value = animal.motherTag || '';
    document.getElementById('editFather').value = animal.fatherSemen || '';
    
    if(!isBull) {
        document.getElementById('editLastCalving').value = animal.lastCalving || '';
        document.getElementById('editLastInsem').value = animal.lastInsemination || '';
        if(document.getElementById('editSemen')) document.getElementById('editSemen').value = animal.semen || '';
        if(document.getElementById('editIsDriedOff')) document.getElementById('editIsDriedOff').checked = animal.isDriedOff || false;
        
        let statusVal = 'unknown';
        if (animal.isPregnantConfirmed) statusVal = 'pregnant';
        else if (animal.usgStatus === 'negative') statusVal = 'negative';
        else if (animal.usgStatus === 'pending') statusVal = 'check';
        document.getElementById('editPregStatus').value = statusVal;
    }

    document.getElementById('animalCardModal').style.display = 'flex';
}

// Funkcja pomocnicza do renderowania list (żeby openAnimalCard nie było za długie)
function renderSubListsForCow(animal) {
    // Potomstwo
    const offspringDiv = document.getElementById('cardOffspring');
    if(offspringDiv) {
        const offspring = myHerd.filter(a => a.motherTag === animal.tag);
        if(offspring.length > 0) {
            offspringDiv.innerHTML = offspring.map(child => 
                `<div onclick="closeModal('animalCardModal'); openAnimalCard('${child.id}')" 
                      style="padding:8px; border-bottom:1px solid #eee; color:#1976d2; cursor:pointer; display:flex; align-items:center; gap:10px;">
                    <i class="bi bi-cow"></i> 
                    <span><b>${child.tag}</b> (${child.type})</span>
                </div>`
            ).join('');
        } else {
            offspringDiv.innerHTML = '<div style="color:#999; font-size:12px; padding:5px;">Brak potomstwa.</div>';
        }
    }
    // Historia Insem
    const histDiv = document.getElementById('cardHistory');
    if(histDiv) {
        histDiv.innerHTML = '';
        const h = animal.historyInsemination || [];
        h.map((val, idx) => ({val, idx})).reverse().forEach(item => {
            const x = item.val;
            const row = document.createElement('div');
            row.style.cssText = 'border-bottom:1px solid #eee; padding:5px 0; display:flex; justify-content:space-between; align-items:center;';
            row.innerHTML = `<span>💉 ${x.date} <small>(${x.bull})</small></span>
                <button class="btn-danger" style="padding:2px 8px; font-size:10px;" onclick="deleteInsemination('${animal.id}', ${item.idx})">🗑</button>`;
            histDiv.appendChild(row);
        });
    }
    // Historia Wycielen
    const calvDiv = document.getElementById('cardCalvingHistory');
    if(calvDiv) {
        calvDiv.innerHTML = '';
        const ch = animal.historyCalving || [];
        [...ch].reverse().forEach(c => {
            calvDiv.innerHTML += `<div style="font-size:12px; padding:5px 0; border-bottom:1px solid #eee;"><span>🍼 Data: <b>${c.date}</b></span></div>`;
        });
    }
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
    
    const newType = document.getElementById('editType').value; // NOWE
    const newTag = document.getElementById('editTag').value;
    const dob = document.getElementById('editDob').value;
    const location = document.getElementById('editLocation').value || '';
    const motherTag = document.getElementById('editMother').value || '';
    const fatherSemen = document.getElementById('editFather').value || '';
    
    // Obiekt do aktualizacji
    let updateData = {
        type: newType, // ZAPIS TYPU
        tag: newTag,
        dob: dob,
        location: location,
        motherTag: motherTag,
        fatherSemen: fatherSemen
    };

    if (newType !== 'byk') {
        const lastCalving = document.getElementById('editLastCalving').value || null;
        const lastInsem = document.getElementById('editLastInsem').value || null;
        const lastSemen = document.getElementById('editSemen')?.value || '';
        const newStatus = document.getElementById('editPregStatus').value;
        const isDriedOffManual = document.getElementById('editIsDriedOff') ? document.getElementById('editIsDriedOff').checked : false;

        let isPreg = false;
        let usg = 'pending';
        if(newStatus === 'pregnant') { isPreg = true; usg = 'positive'; }
        else if(newStatus === 'negative') { isPreg = false; usg = 'negative'; }
        else if(newStatus === 'check') { isPreg = false; usg = 'pending'; }

        updateData.lastCalving = lastCalving;
        updateData.lastInsemination = lastInsem;
        updateData.semen = lastSemen;
        updateData.isPregnantConfirmed = isPreg;
        updateData.usgStatus = usg;
        updateData.isDriedOff = isDriedOffManual;
    }

    db.collection('animals').doc(currentEditingAnimalId).update(updateData).then(() => {
        alert("Zapisano zmiany!");
        openAnimalCard(currentEditingAnimalId);
        // Ważne: Odśwież listę, bo zmiana typu wpływa na filtry
        renderHerdList(); 
        updateDashboardStats();
    }).catch(err => {
        console.error("Błąd zapisu:", err);
        alert("Błąd: " + err.message);
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
// --- NOWOŚĆ: Automatyczna podpowiedź statusu przy dodawaniu ---
    document.getElementById('inpLastInsem').addEventListener('change', (e) => {
        const insemDateVal = e.target.value;
        if (!insemDateVal) return;

        const insemDate = new Date(insemDateVal);
        const today = new Date();
        today.setHours(0,0,0,0);
        
        const diff = Math.floor((today - insemDate) / (1000 * 60 * 60 * 24));
        const statusSelect = document.getElementById('inpPregStatus');

        if (diff < 0) {
            alert("Data zacielenia nie może być z przyszłości!");
            e.target.value = '';
            return;
        }

        // Logika podpowiedzi:
        if (diff < 30) {
            // Poniżej 30 dni - status "Pusta" (bo za wcześnie na USG)
            statusSelect.value = 'negative'; 
            alert("Od zacielenia minęło tylko " + diff + " dni. Status ustawiony na 'Pusta' (Za wcześnie na USG).");
        } else {
            // 30 dni i więcej - status "Do USG"
            statusSelect.value = 'check';
        }
    });
    // --- TUTAJ WKLEJ ---
    document.getElementById('inpLastCalving').addEventListener('change', (e) => {
        if (e.target.value) {
            // Jeśli wpisujesz datę wycielenia, krowa na start jest "Pusta"
            document.getElementById('inpPregStatus').value = 'negative';
            // Czyścimy datę zacielenia, bo po wycieleniu krowa jest pusta
            document.getElementById('inpLastInsem').value = '';
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
        
        // 1. Podstawowe dane
        const type = document.getElementById('inpType').value;
        const tag = document.getElementById('inpTag').value;
        const dob = document.getElementById('inpDob').value;
        
        // 2. NOWE POLA: Lokalizacja i Rodzina
        const location = document.getElementById('inpLocation')?.value || '';
        const motherTag = document.getElementById('inpMother')?.value || '';
        const fatherSemen = document.getElementById('inpFather')?.value || '';

        // 3. Dane rozrodcze (to co zniknęło)
        const lastCalving = document.getElementById('inpLastCalving').value || null;
        const lastInsem = document.getElementById('inpLastInsem').value || null;
        const semen = document.getElementById('inpSemen')?.value || null;
        const pregStatus = document.getElementById('inpPregStatus').value;

        // Logika statusu cielności
        let isPregnantConfirmed = false;
        let usgStatus = 'pending';

        if (pregStatus === 'pregnant') { 
            isPregnantConfirmed = true; 
            usgStatus = 'positive'; 
        } else if (pregStatus === 'check') { 
            isPregnantConfirmed = false; 
            usgStatus = 'pending'; 
        } else { 
            usgStatus = 'negative'; 
            if(lastInsem) usgStatus = 'pending'; 
        }

        // Budowanie historii inseminacji na start, jeśli podano datę
        let historyInsemination = [];
        if(lastInsem) {
            historyInsemination.push({ 
                date: lastInsem, 
                bull: semen || 'Nieznany', 
                note: 'Wpis początkowy', 
                added: new Date().toISOString() 
            });
        }

// 4. ZAPIS DO FIREBASE (Wszystkie pola razem)
        db.collection('animals').add({
            ownerUid: currentUser.uid,
            tag: tag,
            type: type,
            dob: dob,
            location: location,
            motherTag: motherTag,
            fatherSemen: fatherSemen,
            lastCalving: lastCalving,
            lastInsemination: lastInsem,
            semen: semen, // Tutaj zapisujemy nazwę buhaja
            historyInsemination: historyInsemination,
            isPregnantConfirmed: isPregnantConfirmed,
            usgStatus: usgStatus,
            historyCalving: [],
            isDriedOff: false, // Wartość domyślna dla nowej sztuki
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }).then(() => {
            alert("Dodano zwierzę do stada!");
            closeModal('animalModal');
            
            // KLUCZOWE: Odświeżamy widok stada i zadań
            if (typeof generateAndRenderTasks === "function") {
                generateAndRenderTasks();
            }
        }).catch(err => {
            console.error("Błąd zapisu:", err);
            alert("Błąd: " + err.message);
        });
    }); // Koniec listenera submit
} // Koniec funkcji setupModals

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
                <small style="color:#999;">${getBaseText(rule.base)}</small>
            </div>
            <div class="config-inputs">
                <input type="number" id="cfg_cust_start_${idx}" value="${rule.start}">
                <input type="number" id="cfg_cust_end_${idx}" value="${rule.end}">
                <input type="checkbox" id="cfg_cust_enable_${idx}" ${rule.enabled ? 'checked' : ''} style="width:20px; height:20px;">
                <button class="btn-danger" style="width:34px; height:34px; display:flex; align-items:center; justify-content:center; border-radius:6px; padding:0;" onclick="removeCustomRule(${idx})">
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
            const en = document.getElementById(`cfg_cust_enable_${idx}`);
            if(s && e) {
                r.start = parseInt(s.value);
                r.end = parseInt(e.value);
                if(en) r.enabled = en.checked;
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
    window.showAllTasks = false; // DODAJ TO: resetuje widok do 5 sztuk przy zmianie zakładki
    document.querySelectorAll('.sub-tab').forEach(b => {
        b.classList.remove('active');
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

function renderHerdList(forceType = null) {
    const list = document.getElementById('herdList');
    if (!list) return;
    list.innerHTML = '';

    // 1. Przygotowanie danych
    let filtered = [...myHerd];
    const searchInput = document.getElementById('herdSearch');
    const search = searchInput ? searchInput.value.toLowerCase() : '';

    // 2. Liczniki (Aktualizacja)
    const counts = { puste: 0, usg: 0, cielne: 0, jalowka: 0, krowa: 0, byk: 0, zasuszone: 0 };
    myHerd.forEach(a => {
        const s = getDetailedStatus(a);
        
        // Zliczanie typów
        if (a.type === 'jalowka') counts.jalowka++;
        if (a.type === 'krowa') counts.krowa++;
        if (a.type === 'byk') counts.byk++;
        
        // Statusy logiczne (tylko dla samic)
        if (a.type !== 'byk') {
            if (s.category === 'puste') counts.puste++;
            if (s.category === 'usg') counts.usg++;
            if (a.isPregnantConfirmed) counts.cielne++;
            if (a.isDriedOff) counts.zasuszone++;
        }
    });

    for (let key in counts) {
        const el = document.getElementById(`count-${key}`);
        if (el) el.textContent = `(${counts[key]})`;
    }

    // 3. Logika Filtrowania (ŚCISŁA)
    // 3. Logika Filtrowania (ŚCISŁA)
    // Byki i Jałówki widoczne TYLKO w swoich zakładkach
    if (activeHerdFilters.length > 0) {
        filtered = filtered.filter(a => {
            // Jeśli wybrano filtr BYK - pokaż byki
            if (activeHerdFilters.includes('byk') && a.type === 'byk') return true;
            // Jeśli wybrano filtr JAŁÓWKA - pokaż jałówki
            if (activeHerdFilters.includes('jalowka') && a.type === 'jalowka') return true;
            
            // Filtry statusowe (Puste, Cielne, USG) - dotyczą tylko KRÓW i JAŁÓWEK
            if (a.type !== 'byk') {
                const s = getDetailedStatus(a);
                if (activeHerdFilters.includes('cielne') && a.isPregnantConfirmed) return true;
                if (activeHerdFilters.includes('puste') && s.category === 'puste') return true;
                if (activeHerdFilters.includes('usg') && s.category === 'usg') return true;
                if (activeHerdFilters.includes('zasuszone') && a.isDriedOff) return true;
                if (activeHerdFilters.includes('krowa') && a.type === 'krowa') return true;
            }
            return false;
        });
    } else if (!search) {
        // --- TO JEST TA ZMIANA: ---
        // Jeśli nie ma filtrów i nie szukamy -> pokazujemy TYLKO KROWY (domyślny widok)
        filtered = filtered.filter(a => a.type === 'krowa');
    }

    // Obsługa wyszukiwarki (szuka wszędzie)
    if (search) {
        filtered = [...myHerd].filter(a => a.tag.toLowerCase().includes(search));
    }

    // 4. Sortowanie
    filtered.sort((a, b) => {
        // Byki i Jałówki: Od najstarszej (data urodzenia rosnąco)
        if (activeHerdFilters.includes('byk') || activeHerdFilters.includes('jalowka')) {
            const dateA = a.dob ? new Date(a.dob) : new Date();
            const dateB = b.dob ? new Date(b.dob) : new Date();
            return dateA - dateB; 
        }
        // Krowy: Priorytety hodowlane
        const getPriority = (x) => {
            const s = getDetailedStatus(x);
            if (s.category === 'usg') return 1;
            if (s.category === 'puste') return 2;
            if (x.isPregnantConfirmed) return 3;
            return 4;
        };
        return getPriority(a) - getPriority(b);
    });

    if (filtered.length === 0) {
        list.innerHTML = '<div style="text-align:center; padding:20px; color:#999;">Brak zwierząt w tym widoku.</div>';
        return;
    }

    // 5. Renderowanie Kart
    const today = new Date();
    filtered.forEach(a => {
        const div = document.createElement('div');
        div.className = 'card';
        div.style.padding = '10px';
        div.onclick = () => openAnimalCard(a.id);

        let detailsHtml = '';

        // --- WIDOK DLA BYKA (Pkt 5) ---
        if (a.type === 'byk') {
            const dob = new Date(a.dob);
            
            // Obliczanie dat granicznych (24m i 30m)
            const date24m = new Date(dob); date24m.setMonth(date24m.getMonth() + 24);
            const date30m = new Date(dob); date30m.setMonth(date30m.getMonth() + 30);
            
            let targetDate = date24m;
            let targetLabel = "do 24 mies.";
            
            // Jeśli przekroczył 24m, pokazujemy cel na 30m
            if (today > date24m) {
                targetDate = date30m;
                targetLabel = "do 30 mies.";
            }

            // Licznik dni
            const diffTime = targetDate - today;
            const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            const daysLeftColor = daysLeft < 30 ? '#c0392b' : '#2e7d32';
            const displayDays = daysLeft > 0 ? `Zostało: ${daysLeft} dni` : `PRZEKROCZONO o ${Math.abs(daysLeft)} dni`;

            detailsHtml = `
                <div style="font-size:12px; color:#555; margin-top:5px; line-height:1.6;">
                    <div style="display:flex; justify-content:space-between;">
                        <span>📅 Ur: <b>${a.dob}</b></span>
                        <span>📍 Lok: <b>${a.location || '-'}</b></span>
                    </div>
                    <div style="margin-top:5px; padding-top:5px; border-top:1px dashed #ccc;">
                        Cel ${targetLabel}: <b>${targetDate.toLocaleDateString('pl-PL')}</b><br>
                        <span style="color:${daysLeftColor}; font-weight:bold;">${displayDays}</span>
                    </div>
                </div>`;
        } 
        // --- WIDOK DLA JAŁÓWKI (Pkt 6 + status cielności) ---
        else if (a.type === 'jalowka') {
            const statusInfo = getDetailedStatus(a);
            const ins = a.lastInsemination ? a.lastInsemination : '-';
            
            detailsHtml = `
                <div style="font-size:11px; color:#555; margin-top:5px; display:grid; grid-template-columns: 1fr 1fr; gap:5px;">
                    <span style="grid-column: span 2;">📅 Ur: <b>${a.dob}</b> | 📍 Lok: <b>${a.location || '-'}</b></span>
                    <span>💉 Ost. zac: <b>${ins}</b></span>
                    <span style="font-weight:bold; color:${statusInfo.color}; text-align:right;">
                        ${statusInfo.text}
                    </span>
                </div>`;
        }
        // --- WIDOK DLA KROWY ---
        else {
            const statusInfo = getDetailedStatus(a);
            const ins = a.lastInsemination ? a.lastInsemination : '-';
            let calvTermin = '-';
            let dimLabel = '-';

            if (a.lastInsemination) {
                const est = addDays(new Date(a.lastInsemination), userSettings.gestation || 280);
                calvTermin = est.toLocaleDateString('pl-PL');
            }
            if (a.lastCalving) {
                const days = Math.floor((today - new Date(a.lastCalving)) / (1000 * 60 * 60 * 24));
                dimLabel = `${days} dni`;
            }

            detailsHtml = `
                <div style="font-size:11px; color:#555; margin-top:5px; display:grid; grid-template-columns: 1fr 1fr; gap:5px;">
                    <span>💉 Ost. zac: <b>${ins}</b></span>
                    <span>👶 Termin: <b>${calvTermin}</b></span>
                    <span>📊 Laktacja: <b>${dimLabel}</b></span>
                    <span style="font-weight:bold; color:${statusInfo.color}; grid-column: span 2; font-size: 12px; margin-top: 2px;">
                        ${statusInfo.text}
                    </span>
                </div>`;
        }

        div.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <strong style="color:#2e7d32; font-size:16px;">${a.tag}</strong>
                <span class="badge" style="background:#eee; color:#333; padding:2px 8px; border-radius:10px; font-size:10px;">${a.type.toUpperCase()}</span>
            </div>
            ${detailsHtml}
        `;
        list.appendChild(div);
    });
}
// --- MASOWE AKCJE ---

function toggleTaskSelection(taskId) {
    if (selectedTaskIds.includes(taskId)) {
        selectedTaskIds = selectedTaskIds.filter(id => id !== taskId);
    } else {
        selectedTaskIds.push(taskId);
    }
    renderMassActionBar();
}

function renderMassActionBar() {
    let bar = document.getElementById('massActionBar');
    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'massActionBar';
        bar.style.cssText = "position:fixed; bottom:20px; left:50%; transform:translateX(-50%); background:#333; color:white; padding:15px 20px; border-radius:30px; display:none; align-items:center; gap:15px; z-index:9999; box-shadow: 0 5px 15px rgba(0,0,0,0.3);";
        bar.innerHTML = `
            <span id="massCount" style="font-weight:bold;">0 zaznaczonych</span>
            <button onclick="executeMassTasks()" style="background:#4CAF50; border:none; color:white; padding:8px 15px; border-radius:20px; font-weight:bold; cursor:pointer;">✅ Zatwierdź wszystkie</button>
            <button onclick="selectedTaskIds=[]; renderTasks(window.myAllTasksGlobal); renderMassActionBar();" style="background:#f44336; border:none; color:white; padding:8px 15px; border-radius:20px; cursor:pointer;">❌</button>
        `;
        document.body.appendChild(bar);
    }

    if (selectedTaskIds.length > 0) {
        bar.style.display = 'flex';
        document.getElementById('massCount').textContent = `${selectedTaskIds.length} zazn.`;
    } else {
        bar.style.display = 'none';
    }
}

async function executeMassTasks() {
    if (!confirm(`Czy na pewno chcesz potwierdzić wykonanie ${selectedTaskIds.length} zadań?`)) return;

    // Pobieramy pełne obiekty zadań
    const tasksToProcess = window.myAllTasksGlobal.filter(t => selectedTaskIds.includes(t.id));
    
    // Proste przetwarzanie sekwencyjne
    for (const task of tasksToProcess) {
        if (task.type === 'usg') {
            // Dla USG masowo zakładamy, że są CIELNE (typowe działanie). 
            // Jeśli pusta - użytkownik powinien odznaczyć ręcznie.
            await db.collection('animals').doc(task.animalId).update({ isPregnantConfirmed: true, usgStatus: 'positive' });
            saveTaskLog({ taskId: task.id, type: task.type, animalId: task.animalId }, "Pozytywny (Masowo)");
        } 
        else if (task.type === 'dry') {
            await db.collection('animals').doc(task.animalId).update({ isDriedOff: true });
            saveTaskLog({ taskId: task.id, type: task.type, animalId: task.animalId }, "Wykonano (Masowo)");
        }
        else {
            // Inne (Rovac, Kexxtone itp.)
            saveTaskLog({ taskId: task.id, type: task.type, animalId: task.animalId }, "Wykonano (Masowo)");
        }
    }

    alert("Zadania wykonane!");
    selectedTaskIds = [];
    renderMassActionBar();
    // Odświeżenie nastąpi automatycznie przez saveTaskLog -> generateAndRenderTasks
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
