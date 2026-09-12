import { Hono } from 'hono'
import { dbManager } from '../db/index.js'

const state = new Hono()

state.get('/:key', async (c) => {
  const key = c.req.param('key')
  try {
    const value = await dbManager.getAdapter().getState(key)
    return c.json(value ?? null)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return c.json({ error: message }, 500)
  }
})

state.put('/:key', async (c) => {
  const key = c.req.param('key')
  const body = await c.req.json()
  try {
    await dbManager.getAdapter().setState(key, body)
    return c.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return c.json({ error: message }, 500)
  }
})

export default state
