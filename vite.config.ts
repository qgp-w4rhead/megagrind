import { fileURLToPath, URL } from 'node:url'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// Stamps the service worker's cache version with a hash of the emitted
// assets so every build produces a detectably different worker — that is what
// lets the app surface an explicit "update ready" transition.
function serviceWorkerVersion(): Plugin {
  return {
    name: 'megagrind-sw-version',
    apply: 'build',
    closeBundle() {
      const outDir = join(__dirname, 'dist')
      const swPath = join(outDir, 'sw.js')
      const indexPath = join(outDir, 'index.html')
      const stamp = createHash('sha256')
        .update(readFileSync(indexPath))
        .digest('hex')
        .slice(0, 16)
      writeFileSync(swPath, readFileSync(swPath, 'utf8').replace('__SW_VERSION__', stamp))
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
    serviceWorkerVersion(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
  server: {
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
