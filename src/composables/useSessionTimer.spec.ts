import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { effectScope } from 'vue'
import { useSessionTimer } from './useSessionTimer'
import { useMegagrindStore } from '../stores/megagrind'
import type { TimeEntry } from '../types'

function localStore() {
  const store = useMegagrindStore()
  store.settings.backendMode = 'local'
  return store
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

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 8, 9, 15)) // Wed Sep 9 2026, 3pm
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useSessionTimer', () => {
  it('isRunning is true only when the open session matches the type', () => {
    const store = localStore()
    const scope = effectScope()
    const t = scope.run(() => useSessionTimer('work'))!
    expect(t.isRunning.value).toBe(false)
    store.startSession('work')
    expect(t.isRunning.value).toBe(true)
    store.startSession('sleep')
    expect(t.isRunning.value).toBe(false)
    scope.stop()
  })

  it('elapsed ticks upward while the session runs', () => {
    const store = localStore()
    const scope = effectScope()
    const t = scope.run(() => useSessionTimer('work'))!
    store.startSession('work')
    vi.advanceTimersByTime(3000)
    expect(t.elapsed.value).toBeGreaterThanOrEqual(3000)
    vi.advanceTimersByTime(2000)
    expect(t.elapsed.value).toBeGreaterThanOrEqual(5000)
    scope.stop()
  })

  it('elapsed is 0 when this type is not running', () => {
    const store = localStore()
    const scope = effectScope()
    const t = scope.run(() => useSessionTimer('work'))!
    store.startSession('sleep')
    vi.advanceTimersByTime(3000)
    expect(t.elapsed.value).toBe(0)
    scope.stop()
  })

  it('idle: elapsed reflects the open idle entry', () => {
    const store = localStore()
    store.entries.push(
      entry({ id: 'idle1', type: 'idle', start: Date.now() - 5000, end: null }),
    )
    const scope = effectScope()
    const t = scope.run(() => useSessionTimer('idle'))!
    expect(t.isRunning.value).toBe(true)
    expect(t.elapsed.value).toBeGreaterThanOrEqual(5000)
    scope.stop()
  })

  it('todayTotal sums only today entries of the type', () => {
    const store = localStore()
    const H = 3_600_000
    store.entries.push(
      // today 2h
      entry({ id: 't1', type: 'work', start: new Date(2026, 8, 9, 9).getTime(), end: new Date(2026, 8, 9, 11).getTime() }),
      // yesterday — excluded
      entry({ id: 'y1', type: 'work', start: new Date(2026, 8, 8, 9).getTime(), end: new Date(2026, 8, 8, 12).getTime() }),
      // today but different type — excluded
      entry({ id: 's1', type: 'sleep', start: new Date(2026, 8, 9, 1).getTime(), end: new Date(2026, 8, 9, 7).getTime() }),
    )
    const scope = effectScope()
    const t = scope.run(() => useSessionTimer('work'))!
    expect(t.todayTotal.value).toBe(2 * H)
    scope.stop()
  })

  it('weekTotal sums this-week entries of the type', () => {
    const store = localStore()
    store.settings.weekRolloverDay = 0
    store.settings.weekRolloverHour = 0
    const H = 3_600_000
    store.entries.push(
      // this week (Mon Sep 7) 2h
      entry({ id: 'w1', type: 'work', start: new Date(2026, 8, 7, 9).getTime(), end: new Date(2026, 8, 7, 11).getTime() }),
      // last week (Sat Sep 5) — excluded
      entry({ id: 'w0', type: 'work', start: new Date(2026, 8, 5, 9).getTime(), end: new Date(2026, 8, 5, 12).getTime() }),
    )
    const scope = effectScope()
    const t = scope.run(() => useSessionTimer('work'))!
    expect(t.weekTotal.value).toBe(2 * H)
    scope.stop()
  })

  it('history is today-scoped, sorted desc by start, excludes the open entry', () => {
    const store = localStore()
    store.entries.push(
      entry({ id: 'a', type: 'work', start: new Date(2026, 8, 9, 8).getTime(), end: new Date(2026, 8, 9, 9).getTime() }),
      entry({ id: 'b', type: 'work', start: new Date(2026, 8, 9, 10).getTime(), end: new Date(2026, 8, 9, 11).getTime() }),
      entry({ id: 'open', type: 'work', start: new Date(2026, 8, 9, 14).getTime(), end: null }),
      entry({ id: 'old', type: 'work', start: new Date(2026, 8, 8, 10).getTime(), end: new Date(2026, 8, 8, 11).getTime() }),
    )
    const scope = effectScope()
    const t = scope.run(() => useSessionTimer('work'))!
    expect(t.history.value.map((e) => e.id)).toEqual(['b', 'a'])
    scope.stop()
  })

  it('start/stop delegate to the store', () => {
    const store = localStore()
    const startSpy = vi.spyOn(store, 'startSession')
    const stopSpy = vi.spyOn(store, 'stopSession')
    const scope = effectScope()
    const t = scope.run(() => useSessionTimer('work'))!
    t.start('desc', 'dev')
    expect(startSpy).toHaveBeenCalledWith('work', 'desc', 'dev')
    t.stop()
    expect(stopSpy).toHaveBeenCalled()
    scope.stop()
  })
})
