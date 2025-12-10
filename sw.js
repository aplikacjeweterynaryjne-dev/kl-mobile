// 🔒 Nazwa pamięci podręcznej (zmieniona na v92, aby wymusić aktualizację u użytkowników)
const CACHE_NAME = 'karta-leczenia-cache-v92';

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

  // --- ⚠️ KLUCZOWE POPRAWKI: Biblioteki Firebase (niezbędne do startu offline) ---
  'https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js',
  'https://www.gstatic.com/firebasejs/8.10.1/firebase-firestore.js',
  'https://www.gstatic.com/firebasejs/8.10.1/firebase-auth.js'
];

// ⚙️ Instalacja Service Workera
self.addEventListener('install', event => {
  console.log('[Service Worker] Instalacja (v92)...');
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
  console.log('[Service Worker] Aktywacja (v92)...');
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
    // Najpierw próbujemy pobrać najnowszą wersję z sieci.
    // Jeśli się nie uda (brak neta), bierzemy z cache.
    event.respondWith(
      fetch(event.request)
        .then(networkResponse => {
          // 1. Sukces (online) - zapisz nową wersję do cache i ją zwróć
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
          return networkResponse;
        })
        .catch(error => {
          // 2. Błąd (offline) - zwróć starą wersję z cache
          console.log('[Service Worker] Błąd sieci (Network First), zwracam z cache index.html');
          return caches.match(event.request);
        })
    );
  } else {
    // --- STRATEGIA 2: Cache First (dla zasobów: JS, CSS, Obrazy, Firebase SDK) ---
    // Najpierw sprawdzamy cache. Jak jest - zwracamy od razu (szybkość!).
    // Jak nie ma - pobieramy z sieci i zapisujemy na przyszłość.
    event.respondWith(
      caches.match(event.request)
        .then(cachedResponse => {
          // Zwróć z cache, jeśli jest
          if (cachedResponse) {
            return cachedResponse;
          }

          // Jeśli nie ma w cache, spróbuj pobrać z sieci
          return fetch(event.request).then(networkResponse => {
            // Sprawdzamy czy odpowiedź jest poprawna, zanim zapiszemy
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
        .catch(error => {
          console.error('[Service Worker] Błąd pobierania zasobu (Cache First):', error);
          // Opcjonalnie: można tu zwrócić placeholder dla obrazków
        })
    );
  }
});
