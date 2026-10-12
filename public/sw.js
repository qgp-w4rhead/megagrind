// MegaGrind service worker — offline app-shell caching only.
// Personal data never enters this cache: /api requests and every non-GET
// request pass straight to the network. The app's outbox in IndexedDB-ish
// localStorage remains the single authority for queued mutations.
const SW_VERSION = '__SW_VERSION__'
const SHELL_CACHE = `megagrind-shell-${SW_VERSION}`
const SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
  '/apple-touch-icon.png',
  '/favicon.ico',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(async (cache) => {
      // Add individually so one missing asset never blocks installation, but
      // require the entry shell — a worker without it can never reopen offline
      // and failing here keeps the previous working version in control.
      await Promise.allSettled(SHELL_URLS.map((url) => cache.add(url)))
      if (!(await cache.match('/index.html'))) {
        throw new Error('app shell did not cache — refusing to activate a broken install')
      }
      // First install activates immediately so one online visit is enough for
      // offline reopening; later versions wait for the explicit in-app update
      // action (the app decides when a reload is safe).
      if (!self.registration.active) await self.skipWaiting()
    }),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('megagrind-shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.pathname.startsWith('/api/')) return
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    // Network-first: online loads always fetch the freshest shell and refresh
    // its cache entry; offline falls back to the cached copy (any previously
    // visited deep link, then the root shell).
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone()
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy))
          }
          return response
        })
        .catch(() =>
          caches.match(request).then((hit) => hit ?? caches.match('/index.html'))
            .then((hit) => hit ?? Response.error()),
        ),
    )
    return
  }

  // Static assets: cache-first. Vite hashes make emitted assets immutable, so
  // a cached hit is always correct; misses populate the cache for next time.
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone()
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy))
          }
          return response
        }),
    ),
  )
})
