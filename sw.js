const CACHE = 'cardclash-v4';
const ASSETS = [
  './', './index.html', './style.css', './manifest.json',
  './icon-192.png', './icon-512.png', './icon-512-maskable.png',
  './src/main.js', './src/ui.js', './src/battle.js', './src/ai.js', './src/cards.js',
  './src/economy.js', './src/store.js', './src/art.js', './src/silhouettes.js',
  './src/missions.js', './src/dailyDeals.js', './src/actions.js', './src/ladder.js',
  './src/net.js', './src/seasonPass.js', './src/sound.js',
  './art/archer.jpg', './art/darkknight.jpg', './art/dragon.jpg', './art/fireball.jpg',
  './art/fireelemental.jpg', './art/golem.jpg', './art/heal.jpg', './art/iceguardian.jpg',
  './art/impact.jpg', './art/knight.jpg', './art/necromancer.jpg', './art/phoenix.jpg',
  './art/raven.jpg', './art/storm.jpg', './art/titan.jpg', './art/wall.jpg',
  './art/warrior.jpg', './art/wolf.jpg',
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
