// --- KONFIGURACJA FIREBASE (TA SAMA CO W INDEX.HTML) ---
const firebaseConfig = {
    apiKey: "AIzaSyBFSlW9_i877sdlTfGHV4XKGeYlbKPAoM0", // Twoje dane
    authDomain: "kl-mobile-3536f.firebaseapp.com",
    projectId: "kl-mobile-3536f",
    storageBucket: "kl-mobile-3536f.firebasestorage.app",
    messagingSenderId: "420035668375",
    appId: "1:420035668375:web:712c93f1765729b39bbcd2"
};

if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();

let currentUser = null;
let myHerd = [];
let mySettings = { // Domyślne terminy (dni)
    repeatHeat: [18, 21],
    pregnancyDuration: 280,
    usgRange: [45, 180],
    dryOff: 42, // 6 tyg przed
    rovac: 21,  // 3 tyg przed
    kexxtone: 21 // 3 tyg przed
};

// --- AUTH ---
auth.onAuthStateChanged(user => {
    if (user) {
        // Sprawdź czy to na pewno klient
        db.collection('konfiguracja').doc(user.uid).get().then(doc => { // ⚠️ UWAGA: Tutaj zakładam że UID = DocID (lub musisz wyszukać)
            // W nowym systemie rejestracji UID jest w polu `uid`, więc szukamy:
             db.collection('konfiguracja').where('uid', '==', user.uid).get().then(snap => {
                 if(snap.empty) { alert("Brak profilu!"); auth.signOut(); return; }
                 const profile = snap.docs[0].data();
                 if(profile.Rola !== 'klient') {
                     alert("To jest panel dla hodowców. Lekarze logują się w głównej aplikacji.");
                     window.location.href = 'index.html';
                     return;
                 }
                 currentUser = { ...profile, docId: snap.docs[0].id }; // Zapisz profil
                 console.log("Zalogowano klienta:", currentUser);
                 initApp();
             });
        });
    } else {
        window.location.href = 'index.html'; // Wróć do logowania
    }
});

function initApp() {
    loadHerd();
    setupNavigation();
    setupModal();
}

// --- LOGIKA STADA (CRUD) ---

function loadHerd() {
    // Pobieramy zwierzęta, gdzie ownerUid == moje ID
    db.collection('animals').where('ownerUid', '==', currentUser.uid)
      .onSnapshot(snapshot => {
          myHerd = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          updateDashboard();
          renderHerdList();
          renderCalvingCalendar();
      });
}

// --- SILNIK ZADAŃ (CORE) ---
function generateTasks(animal) {
    const tasks = [];
    const today = new Date();

    // 1. Logika Rozrodu (Krowy/Jałówki)
    if ((animal.type === 'krowa' || animal.type === 'jalowka') && animal.lastInsemination) {
        const insDate = new Date(animal.lastInsemination);
        
        // A. Powtórka (ruja)
        const repeatStart = addDays(insDate, 18);
        const repeatEnd = addDays(insDate, 21);
        if (today <= repeatEnd) {
             tasks.push({
                 title: `Obserwacja rui (powtórka)`,
                 date: repeatStart,
                 status: 'warning',
                 animal: animal.tag
             });
        }

        // B. USG (Badanie cielności)
        const usgStart = addDays(insDate, mySettings.usgRange[0]);
        // Jeśli nie oznaczono jako zbadana i data minęła/nadchodzi
        if (!animal.isPregnantConfirmed && today >= usgStart) {
             tasks.push({
                 title: `Badanie USG`,
                 date: usgStart,
                 status: 'urgent',
                 animal: animal.tag,
                 action: 'confirmPregnancy' // Typ akcji
             });
        }

        // C. Wycielenie (Planowane)
        const calvingDate = addDays(insDate, mySettings.pregnancyDuration);
        
        // D. Zasuszenie (Przed wycieleniem)
        const dryOffDate = addDays(calvingDate, -mySettings.dryOff);
        if (animal.type === 'krowa' && !animal.isDry && today >= dryOffDate && today < calvingDate) {
            tasks.push({ title: `Zasuszenie`, date: dryOffDate, status: 'info', animal: animal.tag });
        }

        // E. Rovac / Kexxtone
        const rovacDate = addDays(calvingDate, -mySettings.rovac);
        if (today >= rovacDate && today < calvingDate) tasks.push({ title: `Szczepienie Rovac`, date: rovacDate, status: 'info', animal: animal.tag });

        // Dodaj do kalendarza wycieleń (jako info)
        animal.estimatedCalving = calvingDate;
    }

    // 2. Logika Byków (Sprzedaż)
    if (animal.type === 'byk' && animal.dob) {
        const dob = new Date(animal.dob);
        const ageInMonths = monthDiff(dob, today);
        
        if (ageInMonths >= 20 && ageInMonths < 24) {
            tasks.push({ title: `Sprzedaj byka (I termin)`, date: today, status: 'warning', animal: animal.tag });
        } else if (ageInMonths >= 24) {
            tasks.push({ title: `Sprzedaj byka (PILNE - stary)`, date: today, status: 'urgent', animal: animal.tag });
        }
    }

    return tasks;
}

// --- UI RENDERERS ---

function updateDashboard() {
    // Liczniki
    document.getElementById('cntCows').textContent = myHerd.filter(a => a.type === 'krowa').length;
    document.getElementById('cntHeifers').textContent = myHerd.filter(a => a.type === 'jalowka').length;
    document.getElementById('cntBulls').textContent = myHerd.filter(a => a.type === 'byk').length;

    // Zadania
    const allTasks = [];
    myHerd.forEach(animal => {
        allTasks.push(...generateTasks(animal));
    });

    // Sortuj po dacie
    allTasks.sort((a,b) => a.date - b.date);

    const taskContainer = document.getElementById('tasksList');
    taskContainer.innerHTML = '';
    
    if (allTasks.length === 0) {
        taskContainer.innerHTML = '<p style="color:#777; text-align:center;">Brak pilnych zadań.</p>';
    } else {
        allTasks.forEach(t => {
            const dateStr = t.date.toLocaleDateString();
            const div = document.createElement('div');
            div.className = `task-item ${t.status}`;
            div.innerHTML = `
                <div>
                    <strong>${t.title}</strong> <small>(${dateStr})</small><br>
                    <span>${t.animal}</span>
                </div>
                <input type="checkbox" style="transform:scale(1.5);">
            `;
            taskContainer.appendChild(div);
        });
    }

    // Wykres Laktacji (Prosty przykład)
    renderChart();
}

function renderHerdList() {
    const list = document.getElementById('herdList');
    list.innerHTML = '';
    
    myHerd.forEach(a => {
        const div = document.createElement('div');
        div.className = 'card';
        // Prosta karta zwierzęcia
        div.innerHTML = `
            <div style="display:flex; justify-content:space-between;">
                <h3>🐮 ${a.tag}</h3>
                <span>${a.type.toUpperCase()}</span>
            </div>
            <p>Ur: ${a.dob} | ${a.location || 'Brak lok.'}</p>
            ${a.lastInsemination ? `<p style="color:#2e7d32">Zacielona: ${a.lastInsemination} (${a.semen || '?'})</p>` : ''}
        `;
        list.appendChild(div);
    });
}
// --- BRAKUJĄCA FUNKCJA: KALENDARZ WYCIELEŃ ---
function renderCalvingCalendar() {
    const container = document.getElementById('calvingList');
    if (!container) return;
    
    container.innerHTML = '';
    const events = [];
    const today = new Date();

    // Przeszukaj stado w poszukiwaniu zacielonych sztuk
    myHerd.forEach(animal => {
        if ((animal.type === 'krowa' || animal.type === 'jalowka') && animal.lastInsemination) {
            const insDate = new Date(animal.lastInsemination);
            // Oblicz datę wycielenia (zacielenie + długość ciąży z ustawień)
            const calvingDate = addDays(insDate, mySettings.pregnancyDuration);
            
            // Pokaż tylko te z przyszłości lub niedawnej przeszłości (np. -30 dni)
            // (Żeby nie pokazywać starych, jeśli rolnik zapomniał wpisać wycielenia)
            if (calvingDate > addDays(today, -60)) { 
                const diffTime = calvingDate - today;
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                events.push({
                    animal: animal.tag,
                    date: calvingDate,
                    daysLeft: diffDays
                });
            }
        }
    });

    // Sortuj: Najbliższe wycielenia na górze
    events.sort((a, b) => a.date - b.date);

    if (events.length === 0) {
        container.innerHTML = '<div style="text-align:center; color:#999; padding:20px;">Brak nadchodzących wycieleń.</div>';
        return;
    }

    events.forEach(e => {
        const div = document.createElement('div');
        div.className = 'card';
        div.style.marginBottom = '10px';
        
        // Kolorowanie paska bocznego w zależności od pilności
        let borderSide = '4px solid #2e7d32'; // Zielony (daleko)
        if (e.daysLeft < 14) borderSide = '4px solid #f39c12'; // Pomarańczowy (blisko)
        if (e.daysLeft < 3) borderSide = '4px solid #c0392b';  // Czerwony (zaraz)

        div.style.borderLeft = borderSide;
        
        let statusText = '';
        if (e.daysLeft > 0) statusText = `Za <b>${e.daysLeft}</b> dni`;
        else if (e.daysLeft === 0) statusText = `<b style="color:#c0392b">DZISIAJ!</b>`;
        else statusText = `<span style="color:#777">Minęło ${Math.abs(e.daysLeft)} dni</span>`;

        div.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <span style="font-size:16px; font-weight:bold;">${e.animal}</span>
                    <div style="font-size:12px; color:#555;">Termin: ${e.date.toLocaleDateString()}</div>
                </div>
                <div style="text-align:right;">
                    ${statusText}
                </div>
            </div>
        `;
        container.appendChild(div);
    });
}
function renderChart() {
    const ctx = document.getElementById('lactationChart');
    // Tu dodamy logikę Chart.js później (liczenie dni laktacji)
    // Na razie placeholder
}

// --- FORMULARZE I MODALE ---

// ✅ Ta funkcja była wywoływana, ale nie istniała. Teraz ją definiujemy.
function setupModal() {
    const modal = document.getElementById('animalModal');
    const form = document.getElementById('animalForm');
    const inpType = document.getElementById('inpType');
    const inpDob = document.getElementById('inpDob');
    const addBtn = document.getElementById('addAnimalBtn');
    const closeBtn = document.getElementById('closeModal');

    // 1. Logika zakładek w formularzu
    document.querySelectorAll('.form-tab').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            // Reset UI
            document.querySelectorAll('.form-tab').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            // Aktywuj
            btn.classList.add('active');
            const targetId = btn.dataset.tab;
            if(document.getElementById(targetId)) {
                document.getElementById(targetId).classList.add('active');
            }
        });
    });

    // 2. Dynamiczne pola formularza (wiek > 13m)
    function checkFormLogic() {
        const type = inpType.value;
        const dobVal = inpDob.value;
        
        if (!dobVal) return;

        const dob = new Date(dobVal);
        const today = new Date();
        const ageMonths = monthDiff(dob, today);

        const reproSec = document.getElementById('reproSection');
        const cowSec = document.getElementById('cowSection');
        const bullMsg = document.getElementById('bullMsg');

        if(reproSec) reproSec.classList.add('hidden');
        if(cowSec) cowSec.classList.add('hidden');
        if(bullMsg) bullMsg.classList.add('hidden');

        if (type === 'byk') {
            if(bullMsg) bullMsg.classList.remove('hidden');
        } else {
            // Krowa lub Jałówka
            if (type === 'krowa' || (type === 'jalowka' && ageMonths > 13)) {
                if(reproSec) reproSec.classList.remove('hidden');
            }
            if (type === 'krowa') {
                if(cowSec) cowSec.classList.remove('hidden');
            }
        }
    }

    if(inpType) inpType.addEventListener('change', checkFormLogic);
    if(inpDob) inpDob.addEventListener('change', checkFormLogic);

    // 3. Otwieranie / Zamykanie
    if(addBtn) addBtn.addEventListener('click', () => { modal.style.display = 'flex'; });
    if(closeBtn) closeBtn.addEventListener('click', () => { modal.style.display = 'none'; });

    // 4. Wysyłka formularza
    if(form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const newAnimal = {
                ownerUid: currentUser.uid,
                clinicId: currentUser['ID lecznicy'] || '', // Zabezpieczenie na brak ID
                tag: document.getElementById('inpTag').value,
                location: document.getElementById('inpLoc').value,
                type: document.getElementById('inpType').value,
                dob: document.getElementById('inpDob').value,
                lastInsemination: document.getElementById('inpLastInsem').value || null,
                semen: document.getElementById('inpSemen').value || null,
                lastCalving: document.getElementById('inpLastCalving').value || null,
                notes: document.getElementById('inpNotes').value,
                isPregnantConfirmed: false,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            };

            try {
                await db.collection('animals').add(newAnimal);
                alert("Zwierzę dodane!");
                modal.style.display = 'none';
                form.reset();
            } catch (err) {
                console.error("Błąd zapisu:", err);
                alert("Błąd zapisu: " + err.message);
            }
        });
    }
}

// --- HELPERY ---
function addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}
function monthDiff(d1, d2) {
    let months;
    months = (d2.getFullYear() - d1.getFullYear()) * 12;
    months -= d1.getMonth();
    months += d2.getMonth();
    return months <= 0 ? 0 : months;
}

// Nawigacja dolna
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
        auth.signOut().then(() => window.location.href = 'index.html');
    });
}
