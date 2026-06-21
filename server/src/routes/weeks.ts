import { Hono } from 'hono'
import { dbManager } from '../db/index.js'
import { weekDataSchema } from '../schemas/validation.js'

const weeks = new Hono()

weeks.get('/', async (c) => {
  const data = await dbManager.getAdapter().getWeeks()
  return c.json(data)
})

weeks.get('/:weekStart', async (c) => {
  const weekStart = Number(c.req.param('weekStart'))
  if (Number.isNaN(weekStart)) return c.json({ error: 'Invalid weekStart' }, 400)
  const data = await dbManager.getAdapter().getWeek(weekStart)
  if (!data) return c.json({ error: 'Week not found' }, 404)
  return c.json(data)
})

weeks.post('/', async (c) => {
  const body = await c.req.json()
  const parsed = weekDataSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400)
  const data = await dbManager.getAdapter().saveWeek(parsed.data)
  return c.json(data, 201)
})

export default weeks
