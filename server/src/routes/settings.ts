import { Hono } from 'hono'
import { dbManager } from '../db/index.js'
import { settingsSchema } from '../schemas/validation.js'

const settings = new Hono()

settings.get('/', async (c) => {
  try {
    const data = await dbManager.getAdapter().getSettings()
    return c.json(data ?? null)
  } catch (err) {
    console.error('[Settings] Failed to load settings:', err)
    return c.json({ error: 'Failed to load settings' }, 500)
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
    console.error('[Settings] Failed to update settings:', err)
    return c.json({ error: 'Failed to update settings' }, 500)
  }
})

export default settings
