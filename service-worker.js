// Meu Estudo — service worker
// Ao publicar mudanças, aumente a versão abaixo (v3 -> v4...) junto com o
// APP_VERSION do app.js e o data-version / ?v= do index.html.
const CACHE_NAME = 'estudo-v3';
const CHART_URL = 'https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js';

// Caminhos relativos: funcionam no GitHub Pages (usuario.github.io/repositorio/)
const APP_FILES = [
  './',
  './index.html',
  './style.css?v=3',
  './app.js?v=3',
  './manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // cache: 'reload' = ignora o cache do navegador e baixa tudo novo
    await cache.addAll(APP_FILES.map(url => new Request(url, { cache: 'reload' })));
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
    const old = keys.filter(k => k !== CACHE_NAME);
    await Promise.all(old.map(k => caches.delete(k)));
    await self.clients.claim();
    // Era uma atualização? Recarrega as telas abertas para usar a versão nova.
    if (old.length) {
      const windows = await self.clients.matchAll({ type: 'window' });
      windows.forEach(client => {
        try { client.navigate(client.url).catch(() => {}); } catch (e) { /* ignora */ }
      });
    }
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Arquivos do app: busca na internet primeiro (sem usar cache velho do navegador)
  // e só usa a cópia guardada quando estiver offline.
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const res = await fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' });
        // Safari não aceita resposta "redirecionada" para navegação
        if (res.redirected && req.mode === 'navigate') return Response.redirect(res.url, 302);
        if (res.ok) cache.put(req, res.clone());
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

  // Chart.js do CDN: usa o cache (a versão está fixa, não muda)
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
