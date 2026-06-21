import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { serve } from '@hono/node-server'
import { dbManager } from './db/index.js'
import entriesRoute from './routes/entries.js'
import settingsRoute from './routes/settings.js'
import weeksRoute from './routes/weeks.js'
import dbRoute from './routes/db.js'

const app = new Hono()

app.use('*', logger())
app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
  }),
)

app.get('/api/health', (c) => c.json({ status: 'ok' }))

app.route('/api/entries', entriesRoute)
app.route('/api/settings', settingsRoute)
app.route('/api/weeks', weeksRoute)
app.route('/api/db', dbRoute)

const port = Number(process.env.PORT) || 3000

async function main() {
  await dbManager.init()
  console.log(`[Server] Database initialized: ${dbManager.type}`)

  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`[Server] MEGAGRIND server running on http://localhost:${info.port}`)
  })
}

main().catch((err) => {
  console.error('[Server] Failed to start:', err)
  process.exit(1)
})
