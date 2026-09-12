import { describe, it, expect } from 'vitest'
import type { Hono } from 'hono'
import { createTestApp, makeEntry } from './helpers.js'

const WEEK = 7 * 24 * 60 * 60 * 1000

async function post(app: Hono, body: unknown) {
  return app.request('/api/entries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('entries routes', () => {
  it('POST creates an entry', async () => {
    const { app } = await createTestApp()
    const entry = makeEntry({ id: 'e1' })
    const res = await post(app, entry)
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ id: 'e1', type: 'work' })
  })

  it('GET ?weekStart= filters entries by start within that week', async () => {
    const { app } = await createTestApp()
    const weekStart = 1_700_000_000_000
    await post(app, makeEntry({ id: 'in', start: weekStart + 1000 }))
    await post(app, makeEntry({ id: 'before', start: weekStart - 1000 }))
    await post(app, makeEntry({ id: 'after', start: weekStart + WEEK + 1000 }))

    const res = await app.request(`/api/entries?weekStart=${weekStart}`)
    const data = await res.json()
    expect(data.map((e: { id: string }) => e.id)).toEqual(['in'])
  })

  it('GET ?weekStart= rejects non-numeric value', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/entries?weekStart=abc')
    expect(res.status).toBe(400)
  })

  it('PUT updates an entry', async () => {
    const { app } = await createTestApp()
    await post(app, makeEntry({ id: 'e1', end: null }))
    const res = await app.request('/api/entries/e1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ end: 1_700_000_999_000 }),
    })
    expect(res.status).toBe(200)
    expect((await res.json()).end).toBe(1_700_000_999_000)
  })

  it('DELETE removes an entry', async () => {
    const { app } = await createTestApp()
    await post(app, makeEntry({ id: 'e1' }))
    const res = await app.request('/api/entries/e1', { method: 'DELETE' })
    expect(res.status).toBe(200)
    const all = await (await app.request('/api/entries')).json()
    expect(all).toHaveLength(0)
  })

  describe('POST /bulk', () => {
    it('inserts new entries', async () => {
      const { app } = await createTestApp()
      const res = await app.request('/api/entries/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([makeEntry({ id: 'a' }), makeEntry({ id: 'b' })]),
      })
      expect(res.status).toBe(200)
      const all = await (await app.request('/api/entries')).json()
      expect(all).toHaveLength(2)
    })

    it('upserts by id — re-POST updates instead of duplicating or failing', async () => {
      const { app } = await createTestApp()
      const entry = makeEntry({ id: 'a', end: null })
      await post(app, entry)

      const res = await app.request('/api/entries/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([{ ...entry, end: 1_700_000_700_000 }]),
      })
      expect(res.status).toBe(200)

      const all = await (await app.request('/api/entries')).json()
      expect(all).toHaveLength(1)
      expect(all[0].end).toBe(1_700_000_700_000)
    })

    it('is idempotent — same payload twice yields same state', async () => {
      const { app } = await createTestApp()
      const payload = [makeEntry({ id: 'a' }), makeEntry({ id: 'b' })]
      const req = () =>
        app.request('/api/entries/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      await req()
      await req()
      const all = await (await app.request('/api/entries')).json()
      expect(all).toHaveLength(2)
    })

    it('rejects non-array body with 400', async () => {
      const { app } = await createTestApp()
      const res = await app.request('/api/entries/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'a' }),
      })
      expect(res.status).toBe(400)
    })
  })
})
