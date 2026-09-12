import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import { dbManager } from './db/index.js'

const port = Number(process.env.PORT) || 3000

async function main() {
  await dbManager.init()
  console.log(`[Server] Database initialized: ${dbManager.type}`)

  const app = createApp()
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`[Server] MEGAGRIND server running on http://localhost:${info.port}`)
  })
}

main().catch((err) => {
  console.error('[Server] Failed to start:', err)
  process.exit(1)
})
