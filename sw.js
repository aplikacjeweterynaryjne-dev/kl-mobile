
const CACHE_NAME = 'karta-leczenia-cache-v17';

// 📦 Lista plików do zapamiętania offline (tzw. App Shell)
const urlsToCache = [
  './',
  'index.html',
  'panel-klienta.html',
  'client.js',
  'manifest.json',
  'logo.jpg',
  'https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700&display=swap',
  'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.10.5/font/bootstrap-icons.css',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js',
  'https://www.gstatic.com/firebasejs/8.10.1/firebase-firestore.js',
  'https://www.gstatic.com/firebasejs/8.10.1/firebase-auth.js'
];

// ⚙️ Instalacja Service Workera
self.addEventListener('install', event => {
  console.log('[Service Worker] Instalacja (v5)...');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[Service Worker] Otworzono cache i dodano pliki');
        return cache.addAll(urlsToCache);
      })
  );
});

// ✅ NOWOŚĆ: Nasłuchiwanie na kliknięcie "OK" w panelu klienta (aktualizacja)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('[Service Worker] Otrzymano sygnał SKIP_WAITING. Aktywuję nową wersję...');
    self.skipWaiting();
  }
});

// ♻️ Aktywacja — czyszczenie starych cache
self.addEventListener('activate', event => {
  console.log('[Service Worker] Aktywacja (v5)...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('[Service Worker] Usuwanie starego cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim()) // Przejmij kontrolę nad stroną natychmiast
  );
});

// 🌐 Przechwytywanie zapytań (Logika hybrydowa)
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 🛑 KLUCZOWA ZMIANA: Ignoruj zapytania do bazy danych i API zewnętrzne
  // Pozwalamy przeglądarce obsłużyć je normalnie, dzięki czemu omijamy błędy pętli przekierowań przy Firestore
  if (url.hostname.includes('firestore.googleapis.com') ||
      url.hostname.includes('firebaseio.com') ||
      url.hostname.includes('identitytoolkit') ||
      url.hostname.includes('googleapis')) {
    return; // Zakończ działanie SW dla tego zapytania - niech przeglądarka pobierze to z netu
  }

  // 🛑 IGNORUJ ZAPYTANIA INNE NIŻ GET
  if (event.request.method !== 'GET') {
      return;
  }

  // --- ZAPYTANIA O STRONY HTML ---
  if (event.request.mode === 'navigate') {
    // --- STRATEGIA 1: Network First (dla stron HTML) ---
    event.respondWith(
      fetch(event.request)
        .then(networkResponse => {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
          return networkResponse;
        })
        .catch(error => {
          console.log('[Service Worker] Błąd sieci, zwracam offline HTML');
          // ✅ ignoreSearch: true sprawia, że ignorujemy parametry typu ?simulatedUid=123 lub ?action=install
          return caches.match(event.request, { ignoreSearch: true }); 
        })
    );
  } else {
    // --- ZAPYTANIA O ZASOBY JS, CSS, OBRAZKI ---
    // --- STRATEGIA 2: Cache First (dla zasobów) ---
    event.respondWith(
      // ✅ ignoreSearch: true sprawia, że plik client.js?v=5 odczyta się z cache tak samo jak zwykłe client.js
      caches.match(event.request, { ignoreSearch: true })
        .then(cachedResponse => {
          if (cachedResponse) {
            return cachedResponse;
          }
          return fetch(event.request).then(networkResponse => {
            if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic' && networkResponse.type !== 'cors') {
              return networkResponse;
            }
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, responseToCache);
            });
            return networkResponse;
          });
        })
    );
  }
});

// 🔔 Obsługa kliknięcia w powiadomienie (Messenger style)
self.addEventListener('notificationclick', function(event) {
  console.log('[Service Worker] Kliknięto powiadomienie:', event.notification.tag);
  
  event.notification.close(); // Zamknij dymek powiadomienia

  // Pobierz URL z danych powiadomienia (jeśli istnieje) lub użyj głównego
  const urlToOpen = event.notification.data && event.notification.data.url ? event.notification.data.url : '/';

  // Ta magia sprawia, że po kliknięciu otwiera się aplikacja
  event.waitUntil(
    clients.matchAll({
      type: 'window',
      includeUncontrolled: true 
    }).then(function(clientList) {
      // 1. Sprawdź, czy aplikacja jest już otwarta w którejś karcie
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        // Jeśli tak i przeglądarka pozwala na focus -> skupiamy się na niej
        if (client.url && 'focus' in client) {
          return client.focus();
        }
      }
      // 2. Jeśli nie jest otwarta -> otwórz nowe okno z odpowiednim URL
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
