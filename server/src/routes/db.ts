import { Hono } from 'hono'
import { dbManager } from '../db/index.js'
import { dbSwitchSchema } from '../schemas/validation.js'

const db = new Hono()

db.get('/status', (c) => {
  return c.json({
    active: dbManager.type,
    available: dbManager.getAvailableTypes(),
  })
})

db.post('/switch', async (c) => {
  const body = await c.req.json()
  const parsed = dbSwitchSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400)

  try {
    await dbManager.switch(parsed.data.type)
    return c.json({ active: dbManager.type, available: dbManager.getAvailableTypes() })
  } catch (err) {
    console.error('[DB] Failed to switch database:', err)
    return c.json({ error: 'Failed to switch database' }, 500)
  }
})

export default db
