import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { effectScope, nextTick, ref, type EffectScope } from 'vue'
import { createApp } from 'vue'
import { createPinia, disposePinia, setActivePinia, type Pinia } from 'pinia'
import { megagrindPersistencePlugin } from '../stores/persistencePlugin'
import { useMegagrindStore } from '../stores/megagrind'
import { useTabCoordination, type TabChannel, type TabMessage } from './useTabCoordination'
import { useProgressScheduler } from './useProgressScheduler'
import { encodeStoredSnapshot } from '../domain/persistenceCodec'
import { STORAGE_KEY } from '../domain/backup'

class FakeChannel implements TabChannel {
  static peers = new Set<FakeChannel>()
  onmessage: ((event: { data: TabMessage }) => void) | null = null
  closed = false
  constructor() {
    FakeChannel.peers.add(this)
  }
  postMessage(message: TabMessage) {
    for (const peer of FakeChannel.peers) {
      if (peer !== this && !peer.closed) peer.onmessage?.({ data: message })
    }
  }
  close() {
    this.closed = true
    FakeChannel.peers.delete(this)
  }
}

const pinias: Pinia[] = []
const scopes: EffectScope[] = []

function makeStore() {
  const pinia = createPinia()
  pinia.use(megagrindPersistencePlugin)
  createApp({ template: '<div />' }).use(pinia)
  setActivePinia(pinia)
  pinias.push(pinia)
  return useMegagrindStore()
}

function inScope<T>(fn: () => T): T {
  const scope = effectScope()
  scopes.push(scope)
  return scope.run(fn)!
}

beforeEach(() => {
  FakeChannel.peers.clear()
  localStorage.clear()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-11T12:00:00Z'))
})

afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop())
  pinias.splice(0).forEach((pinia) => disposePinia(pinia))
  vi.useRealTimers()
})

describe('useTabCoordination', () => {
  it('elects the earliest tab as scheduler leader', () => {
    const first = { lastSavedPayload: '', $hydrate: vi.fn() }
    const second = { lastSavedPayload: '', $hydrate: vi.fn() }
    const a = inScope(() => useTabCoordination(first, { makeChannel: () => new FakeChannel(), heartbeatMs: 60_000 }))
    vi.setSystemTime(new Date('2026-10-11T12:00:05Z'))
    const b = inScope(() => useTabCoordination(second, { makeChannel: () => new FakeChannel(), heartbeatMs: 60_000 }))
    expect(a.isLeader.value).toBe(true)
    expect(b.isLeader.value).toBe(false)
  })

  it('leadership passes to the remaining tab when the leader leaves', () => {
    const a = inScope(() => useTabCoordination({ lastSavedPayload: '', $hydrate: vi.fn() }, { makeChannel: () => new FakeChannel(), heartbeatMs: 60_000 }))
    vi.setSystemTime(new Date('2026-10-11T12:00:05Z'))
    const scopeB = effectScope()
    scopes.push(scopeB)
    const b = scopeB.run(() => useTabCoordination({ lastSavedPayload: '', $hydrate: vi.fn() }, { makeChannel: () => new FakeChannel(), heartbeatMs: 60_000 }))!
    expect(b.isLeader.value).toBe(false)
    scopeB.stop()
    expect(a.isLeader.value).toBe(true)
  })

  it('a persisted mutation in one tab rehydrates the shared store in the other', async () => {
    const storeA = makeStore()
    inScope(() => useTabCoordination(storeA, { makeChannel: () => new FakeChannel(), heartbeatMs: 60_000 }))
    const storeB = makeStore()
    inScope(() => useTabCoordination(storeB, { makeChannel: () => new FakeChannel(), heartbeatMs: 60_000 }))

    storeA.startSession('work')
    await nextTick()
    await vi.advanceTimersByTimeAsync(60)
    await nextTick()

    expect(storeB.entries.some((e) => e.type === 'work' && e.end === null)).toBe(true)
    expect(storeB.isRunning).toBe(true)
  })

  it('a second tab starting a session surfaces the open-session conflict in both', async () => {
    const storeA = makeStore()
    inScope(() => useTabCoordination(storeA, { makeChannel: () => new FakeChannel(), heartbeatMs: 60_000 }))
    const storeB = makeStore()
    inScope(() => useTabCoordination(storeB, { makeChannel: () => new FakeChannel(), heartbeatMs: 60_000 }))

    storeA.startSession('work')
    storeB.startSession('chores')
    await nextTick()
    await vi.advanceTimersByTimeAsync(120)
    await nextTick()

    // Both tabs converged on two open records; the conflict is explicit, not
    // silently truncated.
    expect(storeA.openSessionConflict || storeB.openSessionConflict).toBe(true)
    const conflicted = storeA.openSessionConflict ? storeA : storeB
    const keep = conflicted.openEntries[0]!
    expect(conflicted.resolveOpenEntries(keep.id)).toBeNull()
    expect(conflicted.openEntries.map((e) => e.id)).toEqual([keep.id])
  })

  it('rehydrates on the storage event when no channel exists', async () => {
    const store = makeStore()
    inScope(() => useTabCoordination(store, { makeChannel: () => null }))
    localStorage.setItem(STORAGE_KEY, encodeStoredSnapshot({
      schemaVersion: 2,
      entries: [{ id: 'remote', type: 'work', start: 1, end: null }],
      settings: store.settings,
      progressCheck: store.progressCheck,
      progressEvents: [],
      progressHistoryStartedAt: null,
      syncQueue: [],
    }))
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }))
    await vi.advanceTimersByTimeAsync(60)
    await nextTick()
    expect(store.entries.map((e) => e.id)).toEqual(['remote'])
  })
})

describe('scheduler leadership', () => {
  it('only the leader advances deadlines and fires notifications on the clock', async () => {
    const store = makeStore()
    const isLeader = ref(false)
    const spy = vi.spyOn(store, 'reconcileProgress')
    inScope(() => useProgressScheduler(store, { isLeader }))
    spy.mockClear()
    await vi.advanceTimersByTimeAsync(1000)
    expect(spy).not.toHaveBeenCalled()
    isLeader.value = true
    await vi.advanceTimersByTimeAsync(1000)
    expect(spy).toHaveBeenCalled()
  })
})
