// Minimal hand-written service worker (kept separate from vite-plugin-pwa's
// generated one for clarity in review — swap for the generated sw.js at
// build time if you enable VitePWA's `injectRegister`).
const SHELL_CACHE = 'cashscan-shell-v1'
const SHELL_ASSETS = ['/', '/index.html', '/offline.html', '/manifest.json']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // Market/indexer data: never serve stale-first — go to network, and only
  // fall back to a cached copy (if any) when fully offline.
  if (url.hostname === 'indexer.riften.net' || url.hostname.includes('coingecko') || url.hostname.includes('exchangerate')) {
    event.respondWith(
      fetch(request).catch(() => caches.match(request))
    )
    return
  }

  // App shell: cache-first, falling back to network, falling back to offline page.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached
      return fetch(request).catch(() => caches.match('/offline.html'))
    })
  )
})
