/* Azure Echo service worker: lets the game open offline and be installed as an app.
   When you change files and redeploy, bump the number in CACHE so players get the new version. */
const CACHE = "azure-echo-v2";
const FILES = [
  "./", "index.html", "manifest.webmanifest",
  "css/styles.css", "js/config.js", "js/game.js", "js/app.js",
  "assets/echo.webp", "assets/lumen.webp", "assets/glint_eel.webp",
  "assets/shallow_reef.webp", "assets/twilight_zone.webp", "assets/midnight_trench.webp", "assets/abyssal_current.webp",
  "assets/signal_chime.mp3", "assets/success_chime.mp3", "assets/mistake_cue.mp3",
  "assets/azure-echo-icon-192.png", "assets/azure-echo-icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // Only handle our own files. The C# server (another address) is never cached.
  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  const isCode = req.mode === "navigate" || /\.(html|js|css|webmanifest)$/.test(url.pathname);
  if (isCode) {
    // newest version when online, saved copy when offline
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req).then((hit) => hit || caches.match("index.html")))
    );
  } else {
    // art and sound: saved copy first (fast)
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      }))
    );
  }
});
