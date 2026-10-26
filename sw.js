const CACHE_NAME = 'color-balls-shell-v15';
const APP_SHELL = ['./', './index.html', './manifest.json', './icon-256.svg', './icon-512.svg'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    // Install the shell opportunistically; the page itself is always fetched network-first.
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(APP_SHELL.map(async url => {
      try { await cache.add(new Request(url, { cache: 'reload' })); } catch (_) {}
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('color-balls-shell-') && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // HTML: always ask GitHub Pages for the latest version first, use cache only offline.
  if (request.mode === 'navigate' || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/')) {
    event.respondWith((async () => {
      try {
        const response = await fetch(request, { cache: 'no-store' });
        if (response && response.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(request, response.clone()).catch(() => {});
        }
        return response;
      } catch (_) {
        const cached = await caches.match(request) || await caches.match('./index.html') || await caches.match('./');
        if (cached) return cached;
        return new Response('인터넷 연결을 확인한 뒤 다시 실행해 주세요.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    })());
    return;
  }

  // Cache shell assets, while still checking the network first for updates.
  if (APP_SHELL.some(path => url.pathname.endsWith(path.replace('./', '')))) {
    event.respondWith((async () => {
      try {
        const response = await fetch(request, { cache: 'no-store' });
        if (response && response.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(request, response.clone()).catch(() => {});
        }
        return response;
      } catch (_) {
        return await caches.match(request) || Response.error();
      }
    })());
  }
});
