// This file runs in the background, separately from your webpage.
// Its only job: save copies of your app's files so they load with zero signal.

const CACHE_NAME = "gym-tracker-v1";

const FILES_TO_CACHE = [
  "/",
  "/index.html",
  "/style.css",
  "/app.js",
  "/config.js",
  "/manifest.json"
];

// When the service worker first installs, save all the app files.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(FILES_TO_CACHE))
  );
});

// Every time the app asks for a file, check the cache first.
// If it's not there (or you're offline), fall back to the network.
self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request);
    })
  );
});
