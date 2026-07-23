// Service worker : met en cache le "app shell" pour un fonctionnement
// hors-ligne et l'installation en PWA. Les chemins sont relatifs au scope
// (racine du site), donc valables aussi bien en local que sous /bird_song/.

const CACHE = "bird-song-3d-v2";

const ASSETS = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "src/style.css",
  "src/main.js",
  "src/audio.js",
  "src/spectrogram.js",
  "src/palette.js",
  "vendor/three/three.module.js",
  "vendor/three/addons/controls/OrbitControls.js",
  "assets/icon-192.png",
  "assets/icon-512.png",
  "assets/icon-maskable-512.png",
];

// Pré-cache à l'installation.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

// Nettoyage des anciens caches à l'activation.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Stratégie : cache d'abord, réseau en secours (+ mise en cache à la volée).
// Les navigations retombent sur index.html si hors-ligne.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          // Ne met en cache que les réponses valides same-origin.
          if (res.ok && new URL(req.url).origin === self.location.origin) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => {
          if (req.mode === "navigate") return caches.match("index.html");
          return Response.error();
        });
    })
  );
});
