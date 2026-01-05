// 🔒 Nazwa pamięci podręcznej (zmieniona na v94, aby wymusić aktualizację)
const CACHE_NAME = 'karta-leczenia-cache-v93';

// 📦 Lista plików do zapamiętania offline (tzw. App Shell)
const urlsToCache = [
  './',
  'index.html',
  'manifest.json',
  'logo.jpg', 

  // --- Zasoby zewnętrzne (CDN) - style i skrypty ---
  'https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700&display=swap',
  'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.10.5/font/bootstrap-icons.css',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',

  // --- Biblioteki Firebase ---
  'https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js',
  'https://www.gstatic.com/firebasejs/8.10.1/firebase-firestore.js',
  'https://www.gstatic.com/firebasejs/8.10.1/firebase-auth.js'
];

// ⚙️ Instalacja Service Workera
self.addEventListener('install', event => {
  console.log('[Service Worker] Instalacja (v93)...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[Service Worker] Otworzono cache i dodano pliki');
        return cache.addAll(urlsToCache);
      })
      .then(() => self.skipWaiting()) // Wymuś aktywację nowej wersji
  );
});

// ♻️ Aktywacja — czyszczenie starych cache
self.addEventListener('activate', event => {
  console.log('[Service Worker] Aktywacja (v93)...');
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
  // Sprawdź, czy zapytanie dotyczy strony (nawigacji), np. index.html
  if (event.request.mode === 'navigate') {
    // --- STRATEGIA 1: Network First (dla index.html) ---
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
          console.log('[Service Worker] Błąd sieci, zwracam offline index.html');
          return caches.match(event.request);
        })
    );
  } else {
    // --- STRATEGIA 2: Cache First (dla zasobów) ---
    event.respondWith(
      caches.match(event.request)
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

// 🔔 NOWOŚĆ: Obsługa kliknięcia w powiadomienie
self.addEventListener('notificationclick', function(event) {
  console.log('[Service Worker] Kliknięto powiadomienie:', event.notification.tag);
  
  event.notification.close(); // Zamknij dymek powiadomienia

  // Ta magia sprawia, że po kliknięciu otwiera się aplikacja (lub skupia na niej, jeśli jest otwarta)
  event.waitUntil(
    clients.matchAll({
      type: 'window',
      includeUncontrolled: true 
    }).then(function(clientList) {
      // 1. Sprawdź, czy aplikacja jest już otwarta w którejś karcie
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        // Jeśli tak i mamy url (oraz przeglądarka pozwala na focus), skupiamy się na niej
        if (client.url && 'focus' in client) {
          return client.focus();
        }
      }
      // 2. Jeśli nie jest otwarta, otwórz nowe okno
      if (clients.openWindow) {
        return clients.openWindow('./');
      }
    })
  );
});
