import { describe, it, expect } from 'vitest'
import { createTestApp } from './helpers.js'

const fullSettings = {
  weeklyAllocations: { sleep: 49, cook: 7, shower: 2.33, chores: 7, move: 3.5, leisure: 7, unexpected: 2, buffer: 2 },
  customChronos: ['reading'],
  choreCategories: ['laundry', 'dishes'],
  workCategories: ['planning', 'research', 'development', 'setup', 'other'],
  weekRolloverDay: 1,
  weekRolloverHour: 6,
  notificationsEnabled: false,
  soundEnabled: true,
  focusModeDuration: 45,
  progressCheckInterval: 20,
  darkMode: 'dark' as const,
  backendMode: 'sqlite' as const,
  backendUrl: 'http://localhost:3000',
  idleTimeEnabled: false,
  progressCheckEnabled: false,
}

describe('settings routes', () => {
  it('GET returns null when no settings stored', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/settings')
    expect(res.status).toBe(200)
    expect(await res.json()).toBeNull()
  })

  it('PUT accepts and round-trips every client Settings field', async () => {
    const { app } = await createTestApp()
    const put = await app.request('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fullSettings),
    })
    expect(put.status).toBe(200)

    const get = await app.request('/api/settings')
    const stored = await get.json()
    expect(stored).toEqual(fullSettings)
  })

  it('PUT preserves fields the old schema used to strip', async () => {
    const { app } = await createTestApp()
    await app.request('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fullSettings),
    })
    const stored = await (await app.request('/api/settings')).json()
    expect(stored.idleTimeEnabled).toBe(false)
    expect(stored.progressCheckEnabled).toBe(false)
    expect(stored.backendMode).toBe('sqlite')
    expect(stored.backendUrl).toBe('http://localhost:3000')
  })

  it('PUT rejects malformed body with 400', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weeklyAllocations: 'nope' }),
    })
    expect(res.status).toBe(400)
  })
})
