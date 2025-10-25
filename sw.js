// 🔒 Nazwa pamięci podręcznej (zmieniona na v2, aby wymusić aktualizację)
const CACHE_NAME = 'karta-leczenia-cache-v70';

// 📦 Lista plików do zapamiętania offline (tzw. App Shell)
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
  '/sw.js',
];

// ⚙️ Instalacja Service Workera
self.addEventListener('install', event => {
  console.log('[Service Worker] Instalacja (v2)...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[Service Worker] Otworzono cache i dodano pliki');
        // Używamy .addAll(), aby pobrać wszystkie kluczowe zasoby
        // Jeśli którykolwiek zawiedzie, instalacja się nie powiedzie, co jest dobre
        return cache.addAll(urlsToCache);
      })
      .then(() => self.skipWaiting()) // Wymuś aktywację nowej wersji
  );
});

// ♻️ Aktywacja — czyszczenie starych cache
self.addEventListener('activate', event => {
  console.log('[Service Worker] Aktywacja (v2)...');
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

// 🌐 Przechwytywanie zapytań (strategia: Cache First)
self.addEventListener('fetch', event => {
  // Stosujemy strategię "Cache first, falling back to Network"
  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        // Zwróć z cache, jeśli jest
        if (cachedResponse) {
          return cachedResponse;
        }

        // Jeśli nie ma w cache, spróbuj pobrać z sieci
        return fetch(event.request).then(networkResponse => {
          // Jeśli pobrano poprawnie, dodaj do cache i zwróć
          if (networkResponse && networkResponse.status === 200) {
            // Musimy sklonować odpowiedź, bo można ją odczytać tylko raz
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        });
      })
      .catch(error => {
        // W przypadku błędu sieci (np. offline) można zwrócić stronę zastępczą
        // Na razie po prostu logujemy błąd
        console.error('[Service Worker] Błąd pobierania:', error);
        // Możesz tu zwrócić np. stronę offline.html, jeśli ją masz
      })
  );
});
