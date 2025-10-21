// Nazwa naszej pamięci podręcznej
const CACHE_NAME = 'karta-leczenia-cache-v1';

// Pliki, które chcemy przechować (tzw. "App Shell")
// Ten adres URL zostanie wstrzyknięty przez Code.gs
const urlsToCache = [ 'https://script.google.com/macros/s/AKfycbwBv9xN3fWbDGvOUNNBj7vAduO-WxwiSCxciFbPUHZslt8ifVk2rSZoqbqCNBZIzjgQ/exec' ];

// 1. Instalacja Service Workera
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Otwarto cache');
        return cache.addAll(urlsToCache);
      })
  );
});

// 2. Przechwytywanie zapytań (strategia "Cache First")
self.addEventListener('fetch', event => {
  // Ignoruj zapytania do google.script.run (one nie działają offline)
  if (event.request.url.includes('google.script.run')) {
    return fetch(event.request);
  }

  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Jeśli mamy coś w cache, zwróć to
        if (response) {
          return response;
        }
        
        // Jeśli nie, pobierz z sieci, dodaj do cache i zwróć
        return fetch(event.request).then(
          response => {
            if(!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }
            const responseToCache = response.clone();
            caches.open(CACHE_NAME)
              .then(cache => {
                cache.put(event.request, responseToCache);
              });
            return response;
          }
        );
      })
  );
});
