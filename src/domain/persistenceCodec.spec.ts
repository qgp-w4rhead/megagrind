import { describe, it, expect } from 'vitest'
import { decodeStoredCache, encodeStoredSnapshot } from './persistenceCodec'
import { DEFAULT_SETTINGS } from '../types'

const T = (s: string) => Date.parse(s)

function legacyCache(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    entries: [
      { id: 'run-1', type: 'reading', start: T('2026-10-11T17:00:00Z'), end: null, description: 'Book chapter' },
      { id: 'done-1', type: 'work', start: T('2026-10-11T14:00:00Z'), end: T('2026-10-11T15:00:00Z'), category: 'dev' },
    ],
    settings: { ...DEFAULT_SETTINGS, customChronos: ['reading'], weeklyAllocations: { ...DEFAULT_SETTINGS.weeklyAllocations } },
    progressCheck: { lastCheck: null, redCount: 0, snoozeUntil: null, focusModeUntil: null, nextCheckAt: null, remainingMs: null, pendingSessionId: null, pausedReason: null, sessionId: null },
    progressEvents: [],
    progressHistoryStartedAt: null,
    syncQueue: [
      { kind: 'upsert-entry', entry: { id: 'done-1', type: 'work', start: T('2026-10-11T14:00:00Z'), end: T('2026-10-11T15:30:00Z'), category: 'dev' } },
      { kind: 'delete-entry', id: 'gone-1' },
    ],
    ...overrides,
  })
}

describe('stored cache decoding', () => {
  it('an unversioned current cache decodes to a v2 snapshot with exact entries and queue, independent copies, and idempotent re-encoding', () => {
    const raw = legacyCache()
    const first = decodeStoredCache(raw)
    expect(first.kind).toBe('ok')
    if (first.kind !== 'ok') return
    expect(first.sourceVersion).toBe(1)
    const original = JSON.parse(raw)
    expect(first.snapshot.schemaVersion).toBe(2)
    expect(first.snapshot.entries).toEqual(original.entries)
    expect(first.snapshot.syncQueue).toEqual(original.syncQueue)

    const second = decodeStoredCache(raw)
    if (second.kind !== 'ok') throw new Error('second decode failed')
    first.snapshot.entries[0]!.description = 'mutated'
    expect(second.snapshot.entries[0]!.description).toBe('Book chapter')
    expect(JSON.parse(raw).entries[0].description).toBe('Book chapter')

    const encoded = encodeStoredSnapshot(second.snapshot)
    const again = decodeStoredCache(encoded)
    if (again.kind !== 'ok') throw new Error('round trip failed')
    expect(encodeStoredSnapshot(again.snapshot)).toBe(encoded)
  })

  it('missing optional fields normalize to defaults', () => {
    const decoded = decodeStoredCache(JSON.stringify({ entries: [], settings: { darkMode: 'dark' } }))
    if (decoded.kind !== 'ok') throw new Error('expected ok')
    expect(decoded.snapshot.settings.darkMode).toBe('dark')
    expect(decoded.snapshot.settings.weeklyAllocations).toEqual(DEFAULT_SETTINGS.weeklyAllocations)
    expect(decoded.snapshot.settings.backendMode).toBe('local')
    expect(decoded.snapshot.settings.backendUrl).toBe('')
    expect(decoded.snapshot.progressEvents).toEqual([])
    expect(decoded.snapshot.progressHistoryStartedAt).toBeNull()
  })

  it('a defined null, array, nonfinite or negative allocation dictionary triggers recovery and never resets it', () => {
    const cases: Record<string, unknown>[] = [
      { weeklyAllocations: null },
      { weeklyAllocations: [] },
      { weeklyAllocations: { sleep: 'NaN' } },
      { weeklyAllocations: { sleep: -1 } },
    ]
    for (const settings of cases) {
      const raw = legacyCache({ settings: { ...DEFAULT_SETTINGS, ...settings } })
      expect(decodeStoredCache(raw).kind).toBe('recovery')
    }
  })

  it('legacy laundry and dishes fold into chores while a custom budget key and explicit zero are kept', () => {
    const raw = legacyCache({ settings: { ...DEFAULT_SETTINGS, weeklyAllocations: { sleep: 49, laundry: 0, dishes: 0, meditation: 4 } } })
    const decoded = decodeStoredCache(raw)
    if (decoded.kind !== 'ok') throw new Error('expected ok')
    expect(decoded.snapshot.settings.weeklyAllocations.chores).toBe(0)
    expect(decoded.snapshot.settings.weeklyAllocations.meditation).toBe(4)
    expect(decoded.snapshot.settings.weeklyAllocations.sleep).toBe(49)
    expect(decoded.snapshot.settings.weeklyAllocations).not.toHaveProperty('laundry')
    expect(decoded.snapshot.settings.weeklyAllocations).not.toHaveProperty('dishes')
  })

  it('an explicit sqlite endpoint is preserved unchanged', () => {
    const raw = legacyCache({ settings: { ...DEFAULT_SETTINGS, backendMode: 'sqlite', backendUrl: 'http://example.test:3000' } })
    const decoded = decodeStoredCache(raw)
    if (decoded.kind !== 'ok') throw new Error('expected ok')
    expect(decoded.snapshot.settings.backendMode).toBe('sqlite')
    expect(decoded.snapshot.settings.backendUrl).toBe('http://example.test:3000')
  })

  it('invalid, nonfinite, duplicate or future-version input is rejected and leaves the input untouched', () => {
    const raw = legacyCache()
    const before = raw
    const bad = [
      'not json',
      JSON.stringify({ entries: [{ id: 'x', type: 'work', start: 'NaN', end: null }] }),
      JSON.stringify({ entries: [{ id: 'd', type: 'work', start: 1, end: 2 }, { id: 'd', type: 'work', start: 3, end: 4 }] }),
      JSON.stringify({ schemaVersion: 99, entries: [] }),
      JSON.stringify({ entries: [{ id: '', type: 'work', start: 1, end: 2 }] }),
    ]
    for (const text of bad) expect(decodeStoredCache(text).kind).toBe('recovery')
    expect(raw).toBe(before)
  })

  it('an empty cache decodes to the empty kind', () => {
    expect(decodeStoredCache(null).kind).toBe('empty')
  })
})
