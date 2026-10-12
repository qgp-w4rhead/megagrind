import { Hono } from 'hono'
import { dbManager } from '../db/index.js'

const state = new Hono()

state.get('/:key', async (c) => {
  const key = c.req.param('key')
  try {
    const value = await dbManager.getAdapter().getState(key)
    return c.json(value ?? null)
  } catch (err) {
    console.error('[State] Failed to load state:', err)
    return c.json({ error: 'Failed to load state' }, 500)
  }
})

state.put('/:key', async (c) => {
  const key = c.req.param('key')
  const body = await c.req.json()
  try {
    await dbManager.getAdapter().setState(key, body)
    return c.json({ success: true })
  } catch (err) {
    console.error('[State] Failed to write state:', err)
    return c.json({ error: 'Failed to write state' }, 500)
  }
})

export default state
