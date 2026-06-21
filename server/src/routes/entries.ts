import { Hono } from 'hono'
import { dbManager } from '../db/index.js'
import {
  timeEntryCreateSchema,
  timeEntryUpdateSchema,
} from '../schemas/validation.js'

const entries = new Hono()

entries.get('/', async (c) => {
  const weekStart = c.req.query('weekStart')
  const weekStartNum = weekStart ? Number(weekStart) : undefined
  const data = await dbManager.getAdapter().getEntries(weekStartNum)
  return c.json(data)
})

entries.get('/:id', async (c) => {
  const id = c.req.param('id')
  const entry = await dbManager.getAdapter().getEntry(id)
  if (!entry) return c.json({ error: 'Entry not found' }, 404)
  return c.json(entry)
})

entries.post('/', async (c) => {
  const body = await c.req.json()
  const parsed = timeEntryCreateSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400)
  const entry = await dbManager.getAdapter().createEntry(parsed.data)
  return c.json(entry, 201)
})

entries.put('/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const parsed = timeEntryUpdateSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400)
  const entry = await dbManager.getAdapter().updateEntry(id, parsed.data)
  return c.json(entry)
})

entries.delete('/:id', async (c) => {
  const id = c.req.param('id')
  await dbManager.getAdapter().deleteEntry(id)
  return c.json({ success: true })
})

export default entries
