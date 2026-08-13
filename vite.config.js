import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// CashScan — Bitcoin Cash token explorer.
// No backend, no auth, no custody. See src/config.js for the one
// place app identity / API base URLs are defined.
//
// PWA support (manifest.json, sw.js, offline.html, icons) is hand-rolled
// in /public rather than generated, so it's easy to read and audit —
// see main.js for the registration call. Swap in vite-plugin-pwa later
// if you want Workbox's more advanced caching strategies.
export default defineConfig({
  plugins: [vue()],
  server: { port: 5173 }
})
