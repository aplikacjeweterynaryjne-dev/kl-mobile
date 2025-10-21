// 🔒 Nazwa pamięci podręcznej
const CACHE_NAME = 'karta-leczenia-cache-v1';

// 📦 Lista plików do zapamiętania offline (tzw. App Shell)
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
  '/sw.js',
  'https://script.google.com/macros/s/AKfycbwBv9xN3fWbDGvOUNNBj7vAduO-WxwiSCxciFbPUHZslt8ifVk2rSZoqbqCNBZIzjgQ/exec'
];

// ⚙️ Instalacja Service Workera
self.addEventListener('install', event => {
  console.log('[Service Worker] Instalacja...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[Service Worker] Otworzono cache i dodano pliki');
        return cache.addAll(urlsToCache);
      })
  );
});

// ♻️ Aktywacja — czyszczenie starych cache
self.addEventListener('activate', event => {
  console.log('[Service Worker] Aktywacja...');
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
    })
  );
});

// 🌐 Przechwytywanie zapytań (strategia: Cache First)
self.addEventListener('fetch', event => {
  const url = event.request.url;

  // Ignoruj zapytania do google.script.run (bo nie działają offline)
  if (url.includes('google.script.run')) {
    return fetch(event.request);
  }

  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Jeśli plik jest w cache — zwróć go
        if (response) {
          return response;
        }

        // Jeśli nie ma — pobierz z sieci, dodaj do cache i zwróć
        return fetch(event.request).then(networkResponse => {
          if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
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
});
