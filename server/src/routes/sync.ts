import { Hono } from 'hono'
import { dbManager } from '../db/index.js'
import { syncOperationSchema } from '../schemas/validation.js'

export const syncRoutes = new Hono()

syncRoutes.get('/snapshot', async (c) => {
  try {
    const adapter = dbManager.getAdapter()
    return c.json(await adapter.getSyncSnapshot())
  } catch (err) {
    console.error('[Sync] Failed to build snapshot:', err)
    return c.json({ error: 'Failed to build sync snapshot' }, 500)
  }
})

syncRoutes.post('/operations', async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }
  const parsed = syncOperationSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid sync operation', details: parsed.error.flatten() }, 400)
  }
  const op = {
    operationId: parsed.data.operationId,
    kind: parsed.data.kind,
    baseRevision: parsed.data.baseRevision,
    payload: parsed.data.payload,
  }
  try {
    const adapter = dbManager.getAdapter()
    const { replay, result } = await adapter.applySyncOperation(op)
    const body = { operationId: op.operationId, replay, ...result }
    if (result.status === 'applied') return c.json(body, 200)
    if (result.status === 'conflict') return c.json(body, 409)
    return c.json(body, 422)
  } catch (err) {
    console.error('[Sync] Failed to apply operation:', err)
    return c.json({ error: 'Failed to apply sync operation' }, 500)
  }
})
