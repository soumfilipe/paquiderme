// Service worker do Paquiderme: só guarda o "casco" do app para abrir rápido/offline.
// Nunca toca em chamadas à API (são de outra origem e passam direto).
// Ao mudar qualquer arquivo do app, aumente a versão abaixo.
const CACHE = 'paquiderme-v38';
const SHELL = [
  './',
  'index.html',
  'app.js',
  'lib.js',
  'icons.js',
  'style.css',
  'fonts/fonts.css',
  'fonts/bricolage-grotesque-latin-400-normal.woff2',
  'fonts/bricolage-grotesque-latin-700-normal.woff2',
  'fonts/bricolage-grotesque-latin-800-normal.woff2',
  'fonts/jetbrains-mono-latin-400-normal.woff2',
  'fonts/jetbrains-mono-latin-700-normal.woff2',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'brand/logo-mark.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  // rede primeiro (sempre a versão mais nova, ignorando o cache HTTP do navegador); sem rede, usa o guardado
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 6000); // rede muito lenta: cai para o que está guardado
        const res = await fetch(req, { cache: 'no-cache', signal: ctl.signal }).finally(() => clearTimeout(timer));
        if (res.ok) cache.put(url.search ? new Request(url.origin + url.pathname) : req, res.clone());
        return res;
      } catch (err) {
        const cached = await cache.match(req, { ignoreSearch: true });
        if (cached) return cached;
        throw err;
      }
    }),
  );
});

// Avisos push: a instância envia direto ao aparelho; o navegador decifra e entrega o JSON aqui.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data.json(); } catch { d = { title: 'Paquiderme', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Paquiderme', {
    body: d.body || '',
    icon: d.icon || 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    tag: d.notification_id ? 'n' + d.notification_id : undefined,
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if ('focus' in c) { await c.focus(); c.postMessage({ type: 'open-notifications' }); return; }
    }
    await self.clients.openWindow('./?go=notifications');
  })());
});
