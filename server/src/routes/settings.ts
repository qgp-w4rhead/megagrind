import { Hono } from 'hono'
import { dbManager } from '../db/index.js'
import { settingsSchema } from '../schemas/validation.js'

const settings = new Hono()

settings.get('/', async (c) => {
  try {
    const data = await dbManager.getAdapter().getSettings()
    return c.json(data ?? null)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return c.json({ error: message }, 500)
  }
})

settings.put('/', async (c) => {
  const body = await c.req.json()
  const parsed = settingsSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400)
  try {
    const data = await dbManager.getAdapter().updateSettings(parsed.data)
    return c.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return c.json({ error: message }, 500)
  }
})

export default settings
