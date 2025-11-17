// 🔒 Nazwa pamięci podręcznej (zmieniona na v90, aby wymusić aktualizację)
const CACHE_NAME = 'karta-leczenia-cache-v90';

// 📦 Lista plików do zapamiętania offline (tzw. App Shell)
const urlsToCache = [
  './',
  'index.html',
  'manifest.json',
  'logo.jpg', 

  // --- Zasoby zewnętrzne (CDN) ---
  'https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700&display=swap',
  'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.10.5/font/bootstrap-icons.css'
];


// ⚙️ Instalacja Service Workera
self.addEventListener('install', event => {
  console.log('[Service Worker] Instalacja (v90)...');
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
  console.log('[Service Worker] Aktywacja (v90)...');
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
          // ❗️ POPRAWKA: Dodano warunek "event.request.method === 'GET'" ❗️
          if (networkResponse && networkResponse.status === 200 && event.request.method === 'GET') {
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
      })
  );
});
