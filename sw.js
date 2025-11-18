// 🔒 Nazwa pamięci podręcznej (zmieniona na v91, aby wymusić aktualizację)
const CACHE_NAME = 'karta-leczenia-cache-v91';

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
  console.log('[Service Worker] Instalacja (v91)...');
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
  console.log('[Service Worker] Aktywacja (v91)...');
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

// 🌐 Przechwytywanie zapytań (NOWA LOGIKA)
self.addEventListener('fetch', event => {
  // Sprawdź, czy zapytanie dotyczy strony (nawigacji), np. index.html
  if (event.request.mode === 'navigate') {
    // --- STRATEGIA 1: Network First (dla index.html) ---
    event.respondWith(
      fetch(event.request)
        .then(networkResponse => {
          // 1. Sukces (online) - zapisz nową wersję do cache i ją zwróć
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            // Zapisujemy nową wersję index.html
            cache.put(event.request, responseToCache);
          });
          return networkResponse;
        })
        .catch(error => {
          // 2. Błąd (offline) - zwróć starą wersję z cache
          console.log('[Service Worker] Błąd sieci (Network First), zwracam z cache');
          return caches.match(event.request);
        })
    );
  } else {
    // --- STRATEGIA 2: Cache First (dla wszystkiego innego: CSS, JS, obrazy, fonty) ---
    // To jest Twój stary, działający kod dla zasobów
    event.respondWith(
      caches.match(event.request)
        .then(cachedResponse => {
          // Zwróć z cache, jeśli jest
          if (cachedResponse) {
            return cachedResponse;
          }

          // Jeśli nie ma w cache, spróbuj pobrać z sieci
          return fetch(event.request).then(networkResponse => {
            if (networkResponse && networkResponse.status === 200 && event.request.method === 'GET') {
              const responseToCache = networkResponse.clone();
              caches.open(CACHE_NAME).then(cache => {
                cache.put(event.request, responseToCache);
              });
            }
            return networkResponse;
          });
        })
        .catch(error => {
          console.error('[Service Worker] Błąd pobierania (Cache First):', error);
        })
    );
  }
});
