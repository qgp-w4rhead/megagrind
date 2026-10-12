import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { HTTPException } from 'hono/http-exception'
import entriesRoute from './routes/entries.js'
import settingsRoute from './routes/settings.js'
import stateRoute from './routes/state.js'
import dbRoute from './routes/db.js'
import { syncRoutes } from './routes/sync.js'

// Cross-origin browser access is opt-in: ALLOWED_ORIGINS is a comma-separated
// list of frontend origins (e.g. "https://grind.example.com"). Unset means
// same-origin only — requests without an Origin header are unaffected either
// way. Never expose this server publicly without HTTPS and authenticated
// access in front of it.
const MAX_JSON_BODY_BYTES = 1024 * 1024

function parseAllowedOrigins(): string[] {
  return (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
}

export function createApp(): Hono {
  const allowedOrigins = parseAllowedOrigins()
  const app = new Hono()

  app.use('*', logger())
  app.use(
    '*',
    cors({
      origin: (origin) => (origin && allowedOrigins.includes(origin) ? origin : ''),
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type'],
      maxAge: 600,
    }),
  )
  app.use('/api/*', bodyLimit({ maxSize: MAX_JSON_BODY_BYTES }))

  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse()
    console.error('[Server] Unhandled error:', err)
    return c.json({ error: 'Internal server error' }, 500)
  })

  app.get('/api/health', (c) => c.json({ status: 'ok' }))

  app.route('/api/entries', entriesRoute)
  app.route('/api/settings', settingsRoute)
  app.route('/api/state', stateRoute)
  app.route('/api/db', dbRoute)
  app.route('/api/sync', syncRoutes)

  return app
}
