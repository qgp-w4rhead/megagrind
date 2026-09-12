import { Hono } from 'hono'
import { dbManager } from '../db/index.js'
import {
  bulkEntriesSchema,
  timeEntryCreateSchema,
  timeEntryUpdateSchema,
} from '../schemas/validation.js'

const entries = new Hono()

entries.get('/', async (c) => {
  const weekStart = c.req.query('weekStart')
  const weekStartNum = weekStart ? Number(weekStart) : undefined
  if (weekStartNum !== undefined && Number.isNaN(weekStartNum)) {
    return c.json({ error: 'Invalid weekStart' }, 400)
  }
  const data = await dbManager.getAdapter().getEntries(weekStartNum)
  return c.json(data)
})

entries.get('/:id', async (c) => {
  const id = c.req.param('id')
  try {
    const entry = await dbManager.getAdapter().getEntry(id)
    if (!entry) return c.json({ error: 'Entry not found' }, 404)
    return c.json(entry)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return c.json({ error: message }, 500)
  }
})

entries.post('/', async (c) => {
  const body = await c.req.json()
  const parsed = timeEntryCreateSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400)
  try {
    const entry = await dbManager.getAdapter().createEntry(parsed.data)
    return c.json(entry, 201)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return c.json({ error: message }, 500)
  }
})

entries.post('/bulk', async (c) => {
  const body = await c.req.json()
  const parsed = bulkEntriesSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400)
  try {
    await dbManager.getAdapter().bulkUpsertEntries(parsed.data)
    return c.json({ success: true, count: parsed.data.length })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return c.json({ error: message }, 500)
  }
})

entries.post('/bulk', async (c) => {
  const body = await c.req.json()
  const parsed = bulkEntriesSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400)
  try {
    await dbManager.getAdapter().bulkUpsertEntries(parsed.data)
    return c.json({ success: true, count: parsed.data.length })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return c.json({ error: message }, 500)
  }
})

entries.put('/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const parsed = timeEntryUpdateSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400)
  try {
    const entry = await dbManager.getAdapter().updateEntry(id, parsed.data)
    return c.json(entry)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return c.json({ error: message }, 500)
  }
})

entries.delete('/:id', async (c) => {
  const id = c.req.param('id')
  try {
    await dbManager.getAdapter().deleteEntry(id)
    return c.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return c.json({ error: message }, 500)
  }
})

export default entries
