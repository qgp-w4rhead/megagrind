import { describe, it, expect } from 'vitest'
import { createTestApp } from './helpers.js'

describe('state routes', () => {
  it('GET returns null for missing key', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/state/progressCheck')
    expect(res.status).toBe(200)
    expect(await res.json()).toBeNull()
  })

  it('PUT then GET round-trips a JSON blob', async () => {
    const { app } = await createTestApp()
    const blob = { redCount: 2, lastCheck: 1_700_000_000_000, snoozeUntil: null, focusModeUntil: null, nextCheckAt: 1_700_000_900_000 }
    const put = await app.request('/api/state/progressCheck', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(blob),
    })
    expect(put.status).toBe(200)

    const res = await app.request('/api/state/progressCheck')
    expect(await res.json()).toEqual(blob)
  })

  it('PUT overwrites existing key', async () => {
    const { app } = await createTestApp()
    const put = (v: number) =>
      app.request('/api/state/counter', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ v }),
      })
    await put(1)
    await put(2)
    expect(await (await app.request('/api/state/counter')).json()).toEqual({ v: 2 })
  })

  it('keys are independent', async () => {
    const { app } = await createTestApp()
    await app.request('/api/state/a', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(1),
    })
    await app.request('/api/state/b', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(2),
    })
    expect(await (await app.request('/api/state/a')).json()).toBe(1)
    expect(await (await app.request('/api/state/b')).json()).toBe(2)
  })
})
