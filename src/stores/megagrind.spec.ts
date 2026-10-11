import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { useMegagrindStore } from './megagrind'
import type { TimeEntry } from '../types'

const BASE = 'http://localhost:3000'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function pending(): Promise<Response> {
  return new Promise(() => {})
}

let fetchMock: ReturnType<typeof vi.fn>

function lastCall(path: string) {
  return fetchMock.mock.calls.filter(([url]) => String(url).includes(path))
}

function requestBodies(path: string) {
  return lastCall(path).map(([, init]) => JSON.parse(String((init as RequestInit).body)))
}

beforeEach(() => {
  fetchMock = vi.fn().mockImplementation(pending)
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function sqliteStore() {
  const store = useMegagrindStore()
  store.settings.backendMode = 'sqlite'
  store.settings.backendUrl = BASE
  return store
}

describe('sync queue', () => {
  it('enqueues an upsert op when a session starts in sqlite mode', () => {
    const store = sqliteStore()
    store.startSession('work', 'task', 'dev')
    expect(store.syncQueue.length).toBeGreaterThan(0)
    expect(store.syncQueue[0]).toMatchObject({ kind: 'upsert-entry' })
  })

  it('does not enqueue in local mode', () => {
    const store = useMegagrindStore()
    store.settings.backendMode = 'local'
    store.startSession('work')
    expect(store.syncQueue).toHaveLength(0)
  })

  it('coalesces repeated updates to the same entry into one op', () => {
    const store = sqliteStore()
    store.startSession('work')
    const id = store.entries[0]!.id
    store.updateEntry(id, { description: 'a' })
    store.updateEntry(id, { description: 'b' })
    const upserts = store.syncQueue.filter(
      (op) => op.kind === 'upsert-entry' && op.entry.id === id,
    )
    expect(upserts).toHaveLength(1)
    expect((upserts[0] as { entry: TimeEntry }).entry.description).toBe('b')
  })

  it('delete after pending upsert drops the upsert and keeps the delete', () => {
    const store = sqliteStore()
    store.startSession('work')
    const id = store.entries[0]!.id
    store.deleteEntry(id)
    const kinds = store.syncQueue.map((op) => op.kind)
    expect(kinds.filter((k) => k === 'upsert-entry')).toHaveLength(0)
    expect(kinds).toContain('delete-entry')
  })

  it('flushes ops FIFO to the backend', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ success: true }))
    const store = sqliteStore()
    store.startSession('work')
    store.stopSession()
    await store.flushSyncQueue()
    const bodies = requestBodies('/api/entries/bulk')
    // Coalesced: the work entry's transient open state collapses into its
    // final closed state; the open idle entry follows. FIFO order holds.
    expect(bodies).toHaveLength(2)
    expect(bodies[0][0].type).toBe('work')
    expect(bodies[0][0].end).not.toBeNull()
    expect(bodies[1][0].type).toBe('idle')
    expect(bodies[1][0].end).toBeNull()
    expect(store.syncQueue).toHaveLength(0)
  })

  it('keeps ops queued when flush fails and retries after backoff', async () => {
    vi.useFakeTimers()
    fetchMock.mockRejectedValue(new Error('network down'))
    const store = sqliteStore()
    store.startSession('work')
    await store.flushSyncQueue()
    expect(store.syncQueue.length).toBeGreaterThan(0)

    fetchMock.mockResolvedValue(jsonResponse({ success: true }))
    await vi.advanceTimersByTimeAsync(1500)
    expect(store.syncQueue).toHaveLength(0)
  })

  it('persists the queue to localStorage', async () => {
    const store = sqliteStore()
    store.startSession('work')
    // The custom persistence plugin writes on the deep domain-state watcher.
    await nextTick()
    await new Promise((r) => setTimeout(r, 10))
    const raw = localStorage.getItem('megagrind-store')
    expect(raw).toBeTruthy()
    const persisted = JSON.parse(String(raw))
    expect(persisted.syncQueue.length).toBeGreaterThan(0)
  })

  it('enqueues a settings op on updateSettings', () => {
    const store = sqliteStore()
    store.updateSettings({ soundEnabled: true })
    expect(store.syncQueue.some((op) => op.kind === 'settings')).toBe(true)
  })
})

describe('initFromBackend', () => {
  function mockServer(opts: {
    entries?: TimeEntry[]
    settings?: unknown
    progressCheck?: unknown
    reachable?: boolean
  }) {
    const calls = { bulk: [] as TimeEntry[][] }
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const u = String(url)
      if (opts.reachable === false) throw new Error('connection refused')
      if (u.endsWith('/api/health')) return jsonResponse({ status: 'ok' })
      if (u.endsWith('/api/entries/bulk')) {
        calls.bulk.push(JSON.parse(String(init?.body)))
        return jsonResponse({ success: true })
      }
      if (u.endsWith('/api/entries')) return jsonResponse(opts.entries ?? [])
      if (u.endsWith('/api/settings')) {
        if (init?.method === 'PUT') return jsonResponse(JSON.parse(String(init.body)))
        return jsonResponse(opts.settings ?? null)
      }
      if (u.includes('/api/state/progressCheck')) {
        return jsonResponse(opts.progressCheck ?? null)
      }
      return jsonResponse({ success: true })
    })
    return calls
  }

  it('returns early in local mode without fetching', async () => {
    const store = useMegagrindStore()
    store.settings.backendMode = 'local'
    await store.initFromBackend()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('seeds local entries to an empty server via bulk upsert', async () => {
    const calls = mockServer({ entries: [] })
    const store = sqliteStore()
    store.entries.push({
      id: 'local-1',
      type: 'work',
      start: 1000,
      end: 2000,
    })
    await store.initFromBackend()
    expect(calls.bulk.flat().map((e) => e.id)).toContain('local-1')
  })

  it('merges server entries into local state (server wins on conflict)', async () => {
    const remote: TimeEntry = { id: 'r1', type: 'sleep', start: 100, end: 200 }
    mockServer({ entries: [remote] })
    const store = sqliteStore()
    store.entries.push({ id: 'r1', type: 'sleep', start: 100, end: 150 })
    store.entries.push({ id: 'local-only', type: 'cook', start: 300, end: 400 })
    await store.initFromBackend()
    const byId = new Map(store.entries.map((e) => [e.id, e]))
    expect(byId.get('r1')?.end).toBe(200)
    expect(byId.has('local-only')).toBe(true)
  })

  it('falls back to local data when server is unreachable', async () => {
    mockServer({ reachable: false })
    const store = sqliteStore()
    store.entries.push({ id: 'keep', type: 'work', start: 1, end: 2 })
    await store.initFromBackend()
    expect(store.entries.map((e) => e.id)).toContain('keep')
  })

  it('pulls progressCheck state from the server', async () => {
    mockServer({
      entries: [],
      progressCheck: { redCount: 3, lastCheck: 555, snoozeUntil: null, focusModeUntil: null, nextCheckAt: 999 },
    })
    const store = sqliteStore()
    await store.initFromBackend()
    expect(store.progressCheck.redCount).toBe(3)
    expect(store.progressCheck.nextCheckAt).toBe(999)
  })
})

describe('progressCheck sync', () => {
  it('debounces progressCheck mutations into a state op', async () => {
    vi.useFakeTimers()
    const store = sqliteStore()
    store.recordProgressCheck(false)
    store.recordProgressCheck(false)
    await vi.advanceTimersByTimeAsync(3000)
    const stateOps = store.syncQueue.filter((op) => op.kind === 'state')
    expect(stateOps).toHaveLength(1)
    expect(stateOps[0]).toMatchObject({ key: 'progressCheck' })
  })
})
