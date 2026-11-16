// Meu Estudo — service worker
// Ao mudar arquivos do app, aumente a versão abaixo (v2 -> v3...).
const CACHE_NAME = 'estudo-v2';
const CHART_URL = 'https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js';

// Caminhos relativos: funcionam no GitHub Pages (usuario.github.io/repositorio/)
const APP_FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_FILES);
    // Chart.js é opcional: se falhar, o app mostra barras simples
    try {
      const res = await fetch(CHART_URL, { mode: 'cors' });
      if (res.ok) await cache.put(CHART_URL, res);
    } catch (e) { /* sem internet agora, tenta depois */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Arquivos do app: tenta a internet primeiro (pega a versão nova),
  // e usa o cache quando estiver offline.
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const res = await fetch(req);
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      } catch (e) {
        const cached = await cache.match(req, { ignoreSearch: true });
        if (cached) return cached;
        if (req.mode === 'navigate') {
          const index = await cache.match('./index.html');
          if (index) return index;
        }
        throw e;
      }
    })());
    return;
  }

  // Chart.js do CDN: usa o cache (não muda, a versão está fixa)
  if (req.url === CHART_URL) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    })());
  }
});
