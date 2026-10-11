import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useMegagrindStore } from './megagrind'
import { DEFAULT_SETTINGS, createDefaultSettings } from '../types'
import type { TimeEntry } from '../types'

const MIN = 60_000

const created: { $dispose(): void }[] = []

function at(y: number, mo: number, d: number, h = 0, mi = 0, s = 0) {
  vi.setSystemTime(new Date(y, mo, d, h, mi, s))
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
  created.push(store)
  return store
}

function freshStore() {
  setActivePinia(createPinia())
  const store = useMegagrindStore()
  created.push(store)
  return store
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  created.splice(0).forEach((store) => store.$dispose())
  vi.useRealTimers()
})

describe('shared store clock', () => {
  it('ticks now once per second and clears its timer on dispose', () => {
    at(2026, 8, 9, 15)
    const store = localStore()
    vi.advanceTimersByTime(3000)
    expect(store.now).toBe(new Date(2026, 8, 9, 15).getTime() + 3000)
    store.$dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('refreshes now on visibilitychange and pageshow without waiting for a tick', () => {
    at(2026, 8, 9, 15)
    const store = localStore()
    const base = new Date(2026, 8, 9, 15).getTime()
    vi.setSystemTime(base + 400)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(store.now).toBe(base + 400)
    vi.setSystemTime(base + 900)
    window.dispatchEvent(new Event('pageshow'))
    expect(store.now).toBe(base + 900)
  })

  it('start and stop refresh now and boundaries to their action timestamp immediately', () => {
    at(2026, 8, 9, 15)
    const store = localStore()
    store.startSession('work')
    vi.setSystemTime(new Date(2026, 8, 9, 15, 0, 0, 500))
    store.stopSession()
    expect(store.now).toBe(new Date(2026, 8, 9, 15, 0, 0, 500).getTime())
    expect(store.getTotalTimeForType('work')).toBe(500)
  })
})

describe('local day and week rollover on an open store', () => {
  it('today total and history roll over at local midnight without a store mutation', () => {
    at(2026, 8, 9, 22)
    const store = localStore()
    store.entries.push(
      entry({ id: 'morning', type: 'work', start: new Date(2026, 8, 9, 10).getTime(), end: new Date(2026, 8, 9, 11).getTime() }),
      entry({ id: 'open', type: 'work', start: new Date(2026, 8, 9, 22).getTime(), end: null }),
    )
    vi.advanceTimersByTime(119 * MIN + 30_000)
    expect(store.getTotalTimeForTypeAndDay('work', store.getDayStart(), store.getDayEnd())).toBe(119 * MIN + 30_000 + 60 * MIN)
    expect(store.getEntriesByTypeAndDay('work', store.getDayStart(), store.getDayEnd()).map((e) => e.id)).toEqual(['morning'])
    vi.advanceTimersByTime(MIN)
    expect(store.getTotalTimeForTypeAndDay('work', store.getDayStart(), store.getDayEnd())).toBe(30_000)
    expect(store.getEntriesByTypeAndDay('work', store.getDayStart(), store.getDayEnd())).toEqual([])
  })

  it('week totals roll over at the configured hour without a store mutation', () => {
    at(2026, 8, 6, 8)
    const store = localStore()
    store.settings.weekRolloverDay = 0
    store.settings.weekRolloverHour = 9
    store.entries.push(entry({ id: 'open', type: 'work', start: new Date(2026, 8, 6, 8).getTime(), end: null }))
    vi.advanceTimersByTime(59 * MIN + 30_000)
    expect(store.getTotalTimeForType('work')).toBe(59 * MIN + 30_000)
    vi.advanceTimersByTime(MIN)
    expect(store.currentWeekStart).toBe(new Date(2026, 8, 6, 9).getTime())
    expect(store.getTotalTimeForType('work')).toBe(30_000)
  })
})

describe('projected day history', () => {
  it('a midnight-spanning entry is discoverable on both days as projected copies', () => {
    at(2026, 8, 9, 15)
    const store = localStore()
    const original = entry({
      id: 'night',
      type: 'sleep',
      start: new Date(2026, 8, 8, 23).getTime(),
      end: new Date(2026, 8, 9, 1).getTime(),
    })
    store.entries.push(original)
    const day8 = store.getEntriesByTypeAndDay('sleep', store.getDayStart(new Date(2026, 8, 8, 12)), store.getDayEnd(new Date(2026, 8, 8, 12)))
    const day9 = store.getEntriesByTypeAndDay('sleep', store.getDayStart(new Date(2026, 8, 9, 12)), store.getDayEnd(new Date(2026, 8, 9, 12)))
    expect(day8).toEqual([{ ...original, start: new Date(2026, 8, 8, 23).getTime(), end: new Date(2026, 8, 9, 0).getTime() }])
    expect(day9).toEqual([{ ...original, start: new Date(2026, 8, 9, 0).getTime(), end: new Date(2026, 8, 9, 1).getTime() }])
    expect(store.entries[0]).toEqual(original)
  })

  it('signed adjustments stay copies with their original signed timestamps', () => {
    at(2026, 8, 9, 15)
    const store = localStore()
    store.entries.push(
      entry({ id: 'adj', type: 'work', start: new Date(2026, 8, 9, 12).getTime(), end: new Date(2026, 8, 9, 11).getTime(), isCorrection: true }),
    )
    const day9 = store.getEntriesByTypeAndDay('work', store.getDayStart(), store.getDayEnd())
    expect(day9).toEqual([store.entries[0]])
    expect(day9[0]).toMatchObject({ start: new Date(2026, 8, 9, 12).getTime(), end: new Date(2026, 8, 9, 11).getTime() })
  })
})

describe('persistence writes', () => {
  it('idle clock ticks write no persisted state, while a domain change does', async () => {
    at(2026, 8, 9, 15)
    const store = localStore()
    await nextTick()
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    vi.advanceTimersByTime(3000)
    await nextTick()
    expect(setItem).not.toHaveBeenCalled()
    store.entries.push(entry({ id: 'w', type: 'work', start: new Date(2026, 8, 9, 9).getTime(), end: new Date(2026, 8, 9, 10).getTime() }))
    await nextTick()
    expect(setItem).toHaveBeenCalled()
    setItem.mockRestore()
  })
})

describe('progress reset', () => {
  it('clear-all resets blocked history, the streak, history start and any stale pending prompt', () => {
    at(2026, 8, 9, 15)
    const store = localStore()
    store.startSession('work')
    vi.advanceTimersByTime(5 * MIN)
    store.recordProgressCheck(false)
    vi.advanceTimersByTime(MIN)
    store.recordProgressCheck(false)
    store.progressCheck.pendingSessionId = store.currentWorkSessionId
    expect(store.progressEvents).toHaveLength(2)
    expect(store.progressHistoryStartedAt).not.toBeNull()
    store.resetProgressCheck()
    expect(store.progressEvents).toHaveLength(0)
    expect(store.progressHistoryStartedAt).toBeNull()
    expect(store.todayBlockedCount).toBe(0)
    expect(store.progressCheck.redCount).toBe(0)
    expect(store.isProgressPromptDue).toBe(false)
  })
})

describe('defaults and store isolation', () => {
  it('createDefaultSettings returns independent deep copies', () => {
    const a = createDefaultSettings()
    const b = createDefaultSettings()
    expect(a).toEqual(DEFAULT_SETTINGS)
    expect(a.weeklyAllocations).not.toBe(b.weeklyAllocations)
    expect(a.customChronos).not.toBe(b.customChronos)
  })

  it('stores on separate Pinia instances do not share default settings', () => {
    const first = freshStore()
    first.settings.weeklyAllocations.sleep = 1
    first.settings.customChronos.push('x')
    first.settings.workCategories.push('y')
    const second = freshStore()
    expect(second.settings.weeklyAllocations.sleep).toBe(DEFAULT_SETTINGS.weeklyAllocations.sleep)
    expect(second.settings.customChronos).toEqual([])
    expect(second.settings.workCategories).toEqual(DEFAULT_SETTINGS.workCategories)
    expect(DEFAULT_SETTINGS.weeklyAllocations.sleep).toBe(49)
    expect(DEFAULT_SETTINGS.customChronos).toEqual([])
  })
})
