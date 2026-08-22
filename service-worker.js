// This file runs in the background, separately from your webpage.
// Its only job: save copies of your app's files so they load with zero signal.

const CACHE_NAME = "gym-tracker-v5";

const FILES_TO_CACHE = [
  "/",
  "/index.html",
  "/style.css",
  "/app.js",
  "/config.js",
  "/manifest.json",
  "/vendor/supabase.js",
  "/vendor/chart.min.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Cache each file separately. If one fails (like a bad vendor file path),
      // the rest still get saved instead of the whole thing silently failing.
      const results = await Promise.allSettled(
        FILES_TO_CACHE.map((file) => cache.add(file))
      );
      results.forEach((result, i) => {
        if (result.status === "rejected") {
          console.error("Failed to cache:", FILES_TO_CACHE[i], result.reason);
        }
      });
    })
  );
  self.skipWaiting();
});

// Clear out old cache versions so updates actually take effect
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request);
    })
  );
});
