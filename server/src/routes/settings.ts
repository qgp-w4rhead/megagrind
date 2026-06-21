import { Hono } from 'hono'
import { dbManager } from '../db/index.js'
import { settingsSchema } from '../schemas/validation.js'

const settings = new Hono()

settings.get('/', async (c) => {
  const data = await dbManager.getAdapter().getSettings()
  return c.json(data ?? null)
})

settings.put('/', async (c) => {
  const body = await c.req.json()
  const parsed = settingsSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400)
  const data = await dbManager.getAdapter().updateSettings(parsed.data)
  return c.json(data)
})

export default settings
