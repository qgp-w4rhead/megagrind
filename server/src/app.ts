import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import entriesRoute from './routes/entries.js'
import settingsRoute from './routes/settings.js'
import stateRoute from './routes/state.js'
import dbRoute from './routes/db.js'
import { syncRoutes } from './routes/sync.js'

export function createApp(): Hono {
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
  app.route('/api/state', stateRoute)
  app.route('/api/db', dbRoute)
  app.route('/api/sync', syncRoutes)

  return app
}
