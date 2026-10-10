// Service worker: deixa o OFI abrir sem internet.
const CACHE = 'ofi-v11';
const SHELL = ['./', 'index.html', 'styles.css', 'manifest.json', 'icons/favicon.png', 'icons/icon-192.png', 'img/ofi-avatar.png', 'img/ofi-feliz.png', 'img/ofi-calmo.png', 'img/ofi-preocupado.png', 'img/ofi-festa.png',
  'js/app.js', 'js/util.js', 'js/rapido.js', 'js/importar.js', 'js/dividas.js', 'js/categorias.js', 'js/armazenamento.js', 'js/mascote.js', 'js/icones.js', 'js/bloqueio.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Rede primeiro (pega atualizações), cache se estiver offline. A API do GitHub nunca é cacheada.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))),
  );
});
