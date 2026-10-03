/* Small shell cache for static hosting. No camera, pose, or report data is cached. */
const CACHE_NAME = 'gaittrace-shell-v1'
const BASE = new URL('./', self.location.href)
const SHELL = [
  BASE.href,
  new URL('index.html', BASE).href,
  new URL('manifest.webmanifest', BASE).href,
]

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME)
    await cache.addAll(SHELL)
    // Pre-cache the hashed Vite entry points on the first visit so the shell
    // can start offline without relying on a second controlled page load.
    try {
      const response = await fetch(new URL('index.html', BASE))
      const html = await response.text()
      const assets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)]
        .map((match) => new URL(match[1], BASE).href)
        .filter((url) => new URL(url).origin === self.location.origin)
      if (assets.length) await cache.addAll(assets)
    } catch {
      // Static shell remains installable if individual asset caching fails.
    }
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()))
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return
  // Do not cache or intercept API/media requests; this app has no backend.
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
    if (response.ok && (url.pathname.includes('/assets/') || request.mode === 'navigate')) {
      const copy = response.clone()
      void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
    }
    return response
  }).catch(async () => {
    if (request.mode === 'navigate') return (await caches.match(new URL('index.html', BASE))) || (await caches.match(BASE))
    throw new Error('Offline resource unavailable')
  })))
})
