import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { effectScope, type EffectScope } from 'vue'
import { createPinia, disposePinia, getActivePinia, setActivePinia } from 'pinia'
import { useMegagrindStore } from '../stores/megagrind'
import { useProgressScheduler } from './useProgressScheduler'

const MIN = 60_000
const T0 = new Date(2026, 8, 9, 15).getTime()

const shown: { title: string; options: NotificationOptions }[] = []
const requestPermission = vi.fn(async () => 'granted' as NotificationPermission)

class FakeNotification {
  static permission: NotificationPermission = 'granted'
  static requestPermission = requestPermission
  constructor(title: string, options: NotificationOptions) {
    shown.push({ title, options })
  }
}

let scope: EffectScope | undefined

function localStore() {
  const store = useMegagrindStore()
  store.settings.backendMode = 'local'
  return store
}

function startScheduler(store: ReturnType<typeof localStore>) {
  scope = effectScope()
  scope.run(() => useProgressScheduler(store))
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(T0)
  shown.length = 0
  requestPermission.mockClear()
  vi.stubGlobal('Notification', FakeNotification)
})

afterEach(() => {
  scope?.stop()
  scope = undefined
  const active = getActivePinia()
  if (active) disposePinia(active)
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('useProgressScheduler: prompts and answers', () => {
  it('prompts once at 15 minutes, does not repeat at 30, and answering at 16 makes the next deadline 31', () => {
    const store = localStore()
    startScheduler(store)
    store.startSession('work')
    vi.advanceTimersByTime(15 * MIN)
    expect(store.isProgressPromptDue).toBe(true)
    expect(shown).toHaveLength(1)
    vi.advanceTimersByTime(1 * MIN)
    store.recordProgressCheck(true)
    expect(store.progressCheck.nextCheckAt).toBe(T0 + 31 * MIN)
    vi.advanceTimersByTime(14 * MIN)
    expect(store.isProgressPromptDue).toBe(false)
    expect(shown).toHaveLength(1)
  })

  it('a break pauses the countdown: no prompt during the break and a new session gets a fresh 15 minutes', () => {
    const store = localStore()
    startScheduler(store)
    store.startSession('work')
    vi.advanceTimersByTime(5 * MIN)
    store.stopSession()
    expect(store.progressCheck.remainingMs).toBe(10 * MIN)
    expect(store.progressCheck.pausedReason).toBe('not-working')
    vi.advanceTimersByTime(120 * MIN)
    expect(store.isProgressPromptDue).toBe(false)
    expect(shown).toHaveLength(0)
    store.startSession('work')
    expect(store.progressCheck.nextCheckAt).toBe(store.now + 15 * MIN)
    expect(store.progressCheck.remainingMs).toBeNull()
  })

  it('reloading the same session honors the saved deadline', () => {
    const store = localStore()
    startScheduler(store)
    store.startSession('work')
    vi.advanceTimersByTime(5 * MIN)
    const saved = {
      entries: JSON.parse(JSON.stringify(store.entries)),
      progressCheck: JSON.parse(JSON.stringify(store.progressCheck)),
    }
    scope?.stop()
    store.$dispose()
    setActivePinia(createPinia())
    const reloaded = localStore()
    reloaded.entries = saved.entries
    reloaded.progressCheck = saved.progressCheck
    startScheduler(reloaded)
    expect(reloaded.progressCheck.nextCheckAt).toBe(T0 + 15 * MIN)
    vi.advanceTimersByTime(10 * MIN)
    expect(reloaded.isProgressPromptDue).toBe(true)
  })

  it('a focus that ends during a late wake resumes at the focus end and yields one prompt', () => {
    const store = localStore()
    startScheduler(store)
    store.startSession('work')
    vi.advanceTimersByTime(5 * MIN)
    store.enableFocusMode()
    expect(store.progressCheck.focusModeUntil).toBe(T0 + 95 * MIN)
    vi.setSystemTime(T0 + 106 * MIN)
    vi.advanceTimersByTime(1000)
    expect(store.isProgressPromptDue).toBe(true)
    expect(shown).toHaveLength(1)
    expect(store.progressCheck.focusModeUntil).toBeNull()
  })

  it('explicit focus disable at 10 minutes resumes with the saved remaining time', () => {
    const store = localStore()
    startScheduler(store)
    store.startSession('work')
    vi.advanceTimersByTime(5 * MIN)
    store.enableFocusMode()
    vi.advanceTimersByTime(5 * MIN)
    store.disableFocusMode()
    expect(store.progressCheck.nextCheckAt).toBe(T0 + 20 * MIN)
  })

  it('snooze at 15 minutes sets a 30-minute deadline at 45 and prompts exactly then, with no second interval', () => {
    const store = localStore()
    startScheduler(store)
    store.startSession('work')
    vi.advanceTimersByTime(15 * MIN)
    store.snoozeProgressCheck()
    expect(store.progressCheck.nextCheckAt).toBe(T0 + 45 * MIN)
    expect(store.isProgressPromptDue).toBe(false)
    vi.advanceTimersByTime(29 * MIN)
    expect(store.isProgressPromptDue).toBe(false)
    vi.advanceTimersByTime(1 * MIN)
    expect(store.isProgressPromptDue).toBe(true)
    expect(store.progressCheck.nextCheckAt).toBeNull()
  })
})

describe('useProgressScheduler: settings and legacy state', () => {
  it('changing the interval resets a running deadline and replaces remaining time while paused', () => {
    const store = localStore()
    startScheduler(store)
    store.startSession('work')
    store.updateSettings({ progressCheckInterval: 20 })
    expect(store.progressCheck.nextCheckAt).toBe(T0 + 20 * MIN)
    store.stopSession()
    store.updateSettings({ progressCheckInterval: 25 })
    expect(store.progressCheck.remainingMs).toBe(25 * MIN)
  })

  it('disabling clears all check state and enabling starts a fresh interval', () => {
    const store = localStore()
    startScheduler(store)
    store.startSession('work')
    vi.advanceTimersByTime(5 * MIN)
    store.updateSettings({ progressCheckEnabled: false })
    expect(store.progressCheck.nextCheckAt).toBeNull()
    expect(store.progressCheck.pendingSessionId).toBeNull()
    expect(store.progressCheck.snoozeUntil).toBeNull()
    expect(store.progressCheck.pausedReason).toBeNull()
    vi.advanceTimersByTime(20 * MIN)
    expect(store.isProgressPromptDue).toBe(false)
    store.updateSettings({ progressCheckEnabled: true })
    expect(store.progressCheck.nextCheckAt).toBe(store.now + 15 * MIN)
  })

  it('an expired legacy snooze makes the prompt due instead of hiding it forever', () => {
    const store = localStore()
    startScheduler(store)
    store.startSession('work')
    store.progressCheck.nextCheckAt = null
    store.progressCheck.snoozeUntil = T0 + 5 * MIN
    vi.advanceTimersByTime(5 * MIN)
    expect(store.isProgressPromptDue).toBe(true)
    expect(store.progressCheck.snoozeUntil).toBeNull()
  })

  it('changing the interval during a snooze keeps the snoozed deadline', () => {
    const store = localStore()
    startScheduler(store)
    store.startSession('work')
    vi.advanceTimersByTime(15 * MIN)
    store.snoozeProgressCheck()
    vi.advanceTimersByTime(5 * MIN)
    store.updateSettings({ progressCheckInterval: 10 })
    expect(store.progressCheck.nextCheckAt).toBe(T0 + 45 * MIN)
  })

  it('a legacy saved deadline without a session adopts the running work session and keeps its deadline', () => {
    vi.setSystemTime(T0 + 5 * MIN)
    const store = localStore()
    store.entries.push({ id: 'w1', type: 'work', start: T0, end: null })
    store.progressCheck.nextCheckAt = T0 + 15 * MIN
    startScheduler(store)
    expect(store.progressCheck.nextCheckAt).toBe(T0 + 15 * MIN)
    expect(store.progressCheck.sessionId).toBe('w1')
    vi.advanceTimersByTime(10 * MIN)
    expect(store.isProgressPromptDue).toBe(true)
  })

  it('a legacy expired focus resumes at the focus end with its saved remaining time, not a fresh interval', () => {
    const store = localStore()
    store.entries.push({ id: 'w1', type: 'work', start: T0, end: null })
    store.progressCheck.focusModeUntil = T0 + 95 * MIN
    store.progressCheck.remainingMs = 10 * MIN
    store.progressCheck.pausedReason = 'focus'
    startScheduler(store)
    vi.setSystemTime(T0 + 104 * MIN)
    vi.advanceTimersByTime(1000)
    expect(store.isProgressPromptDue).toBe(false)
    vi.setSystemTime(T0 + 106 * MIN)
    vi.advanceTimersByTime(1000)
    expect(store.isProgressPromptDue).toBe(true)
    expect(shown).toHaveLength(1)
  })

  it('enabling with no work shows paused with a full interval and never prompts', () => {
    const store = localStore()
    startScheduler(store)
    expect(store.progressCheck.pausedReason).toBe('not-working')
    expect(store.progressTimeRemaining).toBe(15 * MIN)
    vi.advanceTimersByTime(60 * MIN)
    expect(store.isProgressPromptDue).toBe(false)
  })
})

describe('useProgressScheduler: blocked streak and history', () => {
  it('blocked events survive stop; progress resets only the streak, not the daily blocked count', () => {
    const store = localStore()
    startScheduler(store)
    store.startSession('work')
    vi.advanceTimersByTime(5 * MIN)
    store.recordProgressCheck(false)
    vi.advanceTimersByTime(1 * MIN)
    store.recordProgressCheck(false)
    expect(store.todayBlockedCount).toBe(2)
    expect(store.progressCheck.redCount).toBe(2)
    store.stopSession()
    expect(store.progressEvents.filter((e) => e.outcome === 'blocked')).toHaveLength(2)
    expect(store.todayBlockedCount).toBe(2)
    expect(store.progressCheck.redCount).toBe(2)
    store.startSession('work')
    store.recordProgressCheck(true)
    expect(store.progressCheck.redCount).toBe(0)
    expect(store.todayBlockedCount).toBe(2)
  })

  it('a new day clears the streak while the session is still open without deleting events', () => {
    vi.setSystemTime(new Date(2026, 8, 9, 23))
    const store = localStore()
    startScheduler(store)
    store.startSession('work')
    vi.advanceTimersByTime(30 * MIN)
    store.recordProgressCheck(false)
    expect(store.progressCheck.redCount).toBe(1)
    vi.advanceTimersByTime(40 * MIN)
    expect(store.progressCheck.redCount).toBe(0)
    expect(store.todayBlockedCount).toBe(0)
    expect(store.progressEvents).toHaveLength(1)
  })
})

describe('useProgressScheduler: notifications', () => {
  it('never requests permission on mount and sends exactly one notification per pending state', () => {
    const store = localStore()
    startScheduler(store)
    store.startSession('work')
    expect(requestPermission).not.toHaveBeenCalled()
    vi.advanceTimersByTime(15 * MIN)
    vi.advanceTimersByTime(15 * MIN)
    expect(shown).toHaveLength(1)
    expect(shown[0]!.options.body).toContain('15 minutes')
    expect(requestPermission).not.toHaveBeenCalled()
  })

  it('a throwing notification constructor is reported in-app and never stops the clock', () => {
    class ThrowingNotification {
      static permission: NotificationPermission = 'granted'
      constructor() {
        throw new Error('blocked by browser')
      }
    }
    vi.stubGlobal('Notification', ThrowingNotification)
    const store = localStore()
    startScheduler(store)
    store.startSession('work')
    expect(() => vi.advanceTimersByTime(15 * MIN)).not.toThrow()
    expect(store.isProgressPromptDue).toBe(true)
    expect(store.alertError).not.toBeNull()
    const before = store.now
    vi.advanceTimersByTime(MIN)
    expect(store.now).toBe(before + MIN)
  })
})
