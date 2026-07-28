const CACHE = 'cardclash-v3';
const ASSETS = [
  './', './index.html', './style.css', './manifest.json',
  './icon-192.png', './icon-512.png', './icon-512-maskable.png',
  './src/main.js', './src/ui.js', './src/battle.js', './src/ai.js', './src/cards.js',
  './src/economy.js', './src/store.js', './src/art.js', './src/silhouettes.js',
  './src/missions.js', './src/dailyDeals.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
