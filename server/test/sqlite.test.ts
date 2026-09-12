import { describe, it, expect, beforeEach } from 'vitest'
import { SQLiteDatabaseAdapter } from '../src/db/sqlite.js'
import { makeEntry } from './helpers.js'

describe('SQLiteDatabaseAdapter', () => {
  let adapter: SQLiteDatabaseAdapter

  beforeEach(async () => {
    adapter = new SQLiteDatabaseAdapter(':memory:')
    await adapter.connect()
  })

  it('creates and reads an entry', async () => {
    const entry = makeEntry({ id: 'e1', category: 'dev', description: 'test' })
    await adapter.createEntry(entry)
    expect(await adapter.getEntry('e1')).toEqual(entry)
  })

  it('returns null for missing entry', async () => {
    expect(await adapter.getEntry('nope')).toBeNull()
  })

  it('updates an entry', async () => {
    await adapter.createEntry(makeEntry({ id: 'e1', end: null }))
    const updated = await adapter.updateEntry('e1', { end: 123 })
    expect(updated.end).toBe(123)
    expect((await adapter.getEntry('e1'))?.end).toBe(123)
  })

  it('deletes an entry', async () => {
    await adapter.createEntry(makeEntry({ id: 'e1' }))
    await adapter.deleteEntry('e1')
    expect(await adapter.getEntry('e1')).toBeNull()
  })

  it('bulkUpsertEntries inserts and updates by id', async () => {
    await adapter.bulkUpsertEntries([makeEntry({ id: 'a', end: null }), makeEntry({ id: 'b' })])
    await adapter.bulkUpsertEntries([makeEntry({ id: 'a', end: 999 })])
    const all = await adapter.getEntries()
    expect(all).toHaveLength(2)
    expect(all.find((e) => e.id === 'a')?.end).toBe(999)
  })

  it('getEntries filters by weekStart window', async () => {
    const weekStart = 1_700_000_000_000
    await adapter.createEntry(makeEntry({ id: 'in', start: weekStart + 1 }))
    await adapter.createEntry(makeEntry({ id: 'out', start: weekStart - 1 }))
    const rows = await adapter.getEntries(weekStart)
    expect(rows.map((r) => r.id)).toEqual(['in'])
  })

  it('persists settings round-trip', async () => {
    const settings = {
      weeklyAllocations: { sleep: 49 },
      customChronos: [],
      choreCategories: ['laundry'],
      workCategories: ['dev'],
      weekRolloverDay: 0,
      weekRolloverHour: 0,
      notificationsEnabled: true,
      soundEnabled: false,
      focusModeDuration: 90,
      progressCheckInterval: 15,
      darkMode: 'auto' as const,
      backendMode: 'sqlite' as const,
      backendUrl: 'http://localhost:3000',
      idleTimeEnabled: true,
      progressCheckEnabled: true,
    }
    await adapter.updateSettings(settings)
    expect(await adapter.getSettings()).toEqual(settings)
  })

  it('getState/setState round-trips arbitrary JSON', async () => {
    expect(await adapter.getState('k')).toBeNull()
    await adapter.setState('k', { nested: { v: [1, 2] } })
    expect(await adapter.getState('k')).toEqual({ nested: { v: [1, 2] } })
  })
})
