import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useMegagrindStore } from './megagrind'
import type { TimeEntry } from '../types'

// Sep 12 2026 is a Saturday. Sep 6 = Sunday, Sep 9 = Wednesday, Sep 5 = Saturday.
function at(y: number, mo: number, d: number, h = 0, mi = 0) {
  vi.setSystemTime(new Date(y, mo, d, h, mi, 0))
}

function entry(overrides: Partial<TimeEntry>): TimeEntry {
  return {
    id: overrides.id ?? `e-${Math.random().toString(36).slice(2, 8)}`,
    type: 'work',
    start: 0,
    end: null,
    ...overrides,
  }
}

function localStore() {
  const store = useMegagrindStore()
  store.settings.backendMode = 'local'
  return store
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('getWeekStart', () => {
  it('returns previous Sunday 00:00 for default rollover (Sun, 0h)', () => {
    at(2026, 8, 9, 15) // Wed Sep 9, 3pm
    const store = localStore()
    store.settings.weekRolloverDay = 0
    store.settings.weekRolloverHour = 0
    expect(store.getWeekStart()).toBe(new Date(2026, 8, 6, 0, 0, 0).getTime())
  })

  it('honors a non-zero rollover hour', () => {
    at(2026, 8, 9, 15)
    const store = localStore()
    store.settings.weekRolloverDay = 0
    store.settings.weekRolloverHour = 9
    expect(store.getWeekStart()).toBe(new Date(2026, 8, 6, 9, 0, 0).getTime())
  })

  it('on rollover day BEFORE rollover hour, returns the previous week', () => {
    at(2026, 8, 6, 6) // Sun Sep 6, 6am — before 9am rollover
    const store = localStore()
    store.settings.weekRolloverDay = 0
    store.settings.weekRolloverHour = 9
    // Week started LAST Sunday at 9am, not today (which would be future).
    expect(store.getWeekStart()).toBe(new Date(2026, 7, 30, 9, 0, 0).getTime())
  })

  it('on rollover day AFTER rollover hour, returns today at rollover hour', () => {
    at(2026, 8, 6, 15) // Sun Sep 6, 3pm — after 9am rollover
    const store = localStore()
    store.settings.weekRolloverDay = 0
    store.settings.weekRolloverHour = 9
    expect(store.getWeekStart()).toBe(new Date(2026, 8, 6, 9, 0, 0).getTime())
  })

  it('supports a mid-week rollover day', () => {
    at(2026, 8, 9, 15) // Wed Sep 9, 3pm — after Wed 12pm rollover
    const store = localStore()
    store.settings.weekRolloverDay = 3
    store.settings.weekRolloverHour = 12
    expect(store.getWeekStart()).toBe(new Date(2026, 8, 9, 12, 0, 0).getTime())
  })

  it('mid-week rollover day before the hour returns previous week', () => {
    at(2026, 8, 9, 9) // Wed Sep 9, 9am — before Wed 12pm rollover
    const store = localStore()
    store.settings.weekRolloverDay = 3
    store.settings.weekRolloverHour = 12
    expect(store.getWeekStart()).toBe(new Date(2026, 8, 2, 12, 0, 0).getTime())
  })
})

describe('currentWeekStart', () => {
  it('exposes the computed week start', () => {
    at(2026, 8, 9, 15)
    const store = localStore()
    store.settings.weekRolloverDay = 0
    store.settings.weekRolloverHour = 0
    expect(store.currentWeekStart).toBe(new Date(2026, 8, 6, 0, 0, 0).getTime())
  })

  it('recomputes when rollover settings change', () => {
    at(2026, 8, 9, 15)
    const store = localStore()
    store.settings.weekRolloverDay = 0
    store.settings.weekRolloverHour = 0
    const sunday = store.currentWeekStart
    store.settings.weekRolloverDay = 1 // Monday
    expect(store.currentWeekStart).not.toBe(sunday)
    expect(store.currentWeekStart).toBe(new Date(2026, 8, 7, 0, 0, 0).getTime())
  })
})

describe('getTotalTimeForType week scoping', () => {
  it('counts only entries starting at or after currentWeekStart', () => {
    at(2026, 8, 9, 15) // Wed; weekStart = Sun Sep 6 00:00
    const store = localStore()
    store.settings.weekRolloverDay = 0
    store.settings.weekRolloverHour = 0
    const H = 3_600_000
    store.entries.push(
      // last week — excluded
      entry({ id: 'old', type: 'work', start: new Date(2026, 8, 5, 10).getTime(), end: new Date(2026, 8, 5, 12).getTime() }),
      // this week — included (2h)
      entry({ id: 'new', type: 'work', start: new Date(2026, 8, 7, 10).getTime(), end: new Date(2026, 8, 7, 12).getTime() }),
    )
    expect(store.getTotalTimeForType('work')).toBe(2 * H)
  })

  it('entry crossing the boundary counts by its start (excluded if start < weekStart)', () => {
    at(2026, 8, 9, 15)
    const store = localStore()
    store.settings.weekRolloverDay = 0
    store.settings.weekRolloverHour = 0
    store.entries.push(
      // starts Sat 23:00 (before Sun 00:00 weekStart), ends Sun 01:00 — excluded
      entry({ id: 'cross', type: 'work', start: new Date(2026, 8, 5, 23).getTime(), end: new Date(2026, 8, 6, 1).getTime() }),
    )
    expect(store.getTotalTimeForType('work')).toBe(0)
  })

  it('excludes open (running) entries from totals', () => {
    at(2026, 8, 9, 15)
    const store = localStore()
    store.entries.push(
      entry({ id: 'open', type: 'work', start: new Date(2026, 8, 9, 10).getTime(), end: null }),
    )
    expect(store.getTotalTimeForType('work')).toBe(0)
  })

  it('scopes per type — other types unaffected', () => {
    at(2026, 8, 9, 15)
    const store = localStore()
    const H = 3_600_000
    store.entries.push(
      entry({ id: 'w', type: 'work', start: new Date(2026, 8, 7, 10).getTime(), end: new Date(2026, 8, 7, 12).getTime() }),
      entry({ id: 's', type: 'sleep', start: new Date(2026, 8, 7, 23).getTime(), end: new Date(2026, 8, 8, 7).getTime() }),
    )
    expect(store.getTotalTimeForType('work')).toBe(2 * H)
    expect(store.getTotalTimeForType('sleep')).toBe(8 * H)
  })
})
