import { describe, it, expect } from 'vitest'
import { decodeStoredCache, encodeStoredSnapshot } from './persistenceCodec'
import { DEFAULT_SETTINGS } from '../types'

const T = (s: string) => Date.parse(s)

// Models a real pre-M5.1 store: DEFAULT_SETTINGS now ships the new keys, so
// they must be stripped for the fixture to exercise the migration path.
const legacyDefaults = (() => {
  const s = { ...DEFAULT_SETTINGS } as Record<string, unknown>
  delete s.activities
  delete s.goals
  delete s.onboardingCompleted
  return s
})()

function legacyCache(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    entries: [
      { id: 'run-1', type: 'reading', start: T('2026-10-11T17:00:00Z'), end: null, description: 'Book chapter' },
      { id: 'done-1', type: 'work', start: T('2026-10-11T14:00:00Z'), end: T('2026-10-11T15:00:00Z'), category: 'dev' },
    ],
    settings: { ...legacyDefaults, customChronos: ['reading'], weeklyAllocations: { ...(legacyDefaults.weeklyAllocations as object) } },
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
    // Legacy pre-protocol ops migrate to blocked envelopes: intent is kept,
    // but they can never flush until an endpoint is explicitly assigned.
    expect(first.snapshot.syncQueue).toHaveLength(2)
    expect(first.snapshot.syncQueue[0]).toMatchObject({
      kind: 'entry-upsert',
      endpointId: null,
      status: 'blocked',
    })
    expect((first.snapshot.syncQueue[0]!.payload as { id: string }).id).toBe('done-1')
    expect(first.snapshot.syncQueue[1]).toMatchObject({
      kind: 'entry-delete',
      endpointId: null,
      status: 'blocked',
    })

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

describe('activities, goals and onboarding migration', () => {
  it('persists activities, goals and onboardingCompleted through an encode/decode round trip', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      onboardingCompleted: true,
      activities: [
        { id: 'work', label: 'Work', favorite: true, archived: false, order: 0 },
        { id: 'reading', label: 'Reading', favorite: false, archived: true, order: 99 },
      ],
      goals: { work: { policy: 'target', hours: 40 }, sleep: { policy: 'minimum', hours: 49 } },
    }
    const raw = legacyCache({ settings })
    const decoded = decodeStoredCache(raw)
    if (decoded.kind !== 'ok') throw new Error('expected ok')
    expect(decoded.snapshot.settings.onboardingCompleted).toBe(true)
    expect(decoded.snapshot.settings.goals).toEqual(settings.goals)
    expect(decoded.snapshot.settings.activities.find((a) => a.id === 'work')?.favorite).toBe(true)
    expect(decoded.snapshot.settings.activities.find((a) => a.id === 'reading')?.archived).toBe(true)
    const redecoded = decodeStoredCache(encodeStoredSnapshot(decoded.snapshot))
    if (redecoded.kind !== 'ok') throw new Error('round trip failed')
    expect(redecoded.snapshot.settings.activities).toEqual(decoded.snapshot.settings.activities)
    expect(redecoded.snapshot.settings.goals).toEqual(decoded.snapshot.settings.goals)
  })

  it('an existing store without the new fields stays out of onboarding and gets no goals, while definitions cover its custom and history types', () => {
    const decoded = decodeStoredCache(legacyCache())
    if (decoded.kind !== 'ok') throw new Error('expected ok')
    // Existing data found → onboarding already complete; no goals silently added.
    expect(decoded.snapshot.settings.onboardingCompleted).toBe(true)
    expect(decoded.snapshot.settings.goals).toEqual({})
    const ids = decoded.snapshot.settings.activities.map((a) => a.id)
    for (const id of ['reading', 'work', 'sleep', 'leisure']) expect(ids).toContain(id)
    expect(ids).not.toContain('idle')
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('a store without a settings blob at all is treated as existing (no forced onboarding)', () => {
    const decoded = decodeStoredCache(JSON.stringify({ entries: [], progressEvents: [] }))
    if (decoded.kind !== 'ok') throw new Error('expected ok')
    expect(decoded.snapshot.settings.onboardingCompleted).toBe(true)
  })

  it('malformed goals or activity definitions trigger recovery rather than silent defaults', () => {
    const bad = [
      { goals: [] },
      { goals: { work: { policy: 'nonsense', hours: 4 } } },
      { goals: { work: { policy: 'target', hours: -2 } } },
      { activities: [{ id: 'work' }] },
      { activities: [{ id: 'x', label: 'X', favorite: 1, archived: false, order: 0 }] },
    ]
    for (const settings of bad) {
      const raw = legacyCache({ settings: { ...DEFAULT_SETTINGS, ...settings } })
      expect(decodeStoredCache(raw).kind).toBe('recovery')
    }
  })
})
