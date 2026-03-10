self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open('modex-shell-v1').then((cache) =>
      cache.addAll(['/', '/manifest.webmanifest', '/icon.svg']),
    ),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/')));
    return;
  }

  const requestUrl = new URL(request.url);
  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        return cached;
      }

      return fetch(request).then((response) => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }

        const responseClone = response.clone();
        caches.open('modex-shell-v1').then((cache) => cache.put(request, responseClone));
        return response;
      });
    }),
  );
});
