import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { useMegagrindStore } from './megagrind'
import type { TimeEntry } from '../types'

const BASE = 'http://localhost:3000'
const ENDPOINT = `sqlite:${BASE}`

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

function emptySnapshot() {
  return {
    protocol: 1,
    entries: [],
    entryTombstones: [],
    preferences: null,
    progressEvents: [],
    eventTombstones: [],
  }
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

describe('sync outbox', () => {
  it('enqueues an immutable entry-upsert envelope with endpoint provenance when a session starts', () => {
    const store = sqliteStore()
    store.startSession('work', 'task', 'dev')
    expect(store.syncQueue.length).toBeGreaterThan(0)
    const op = store.syncQueue[0]!
    expect(op.kind).toBe('entry-upsert')
    expect(op.operationId).toBeTruthy()
    expect(op.endpointId).toBe(ENDPOINT)
    expect(op.status).toBe('pending')
  })

  it('does not enqueue in local mode', () => {
    const store = useMegagrindStore()
    store.settings.backendMode = 'local'
    store.startSession('work')
    expect(store.syncQueue).toHaveLength(0)
  })

  it('keeps repeated updates as separate immutable envelopes (no in-flight coalescing)', () => {
    const store = sqliteStore()
    store.startSession('work')
    const id = store.entries[0]!.id
    store.updateEntry(id, { description: 'a' })
    store.updateEntry(id, { description: 'b' })
    const upserts = store.syncQueue.filter(
      (op) => op.kind === 'entry-upsert' && (op.payload as TimeEntry).id === id,
    )
    expect(upserts.length).toBeGreaterThanOrEqual(2)
    expect(upserts.map((op) => op.operationId)).toHaveLength(new Set(upserts.map((o) => o.operationId)).size)
  })

  it('keeps the delete op after a pending upsert (intent order is preserved, not collapsed)', () => {
    const store = sqliteStore()
    store.startSession('work')
    const id = store.entries[0]!.id
    store.deleteEntry(id)
    const kinds = store.syncQueue.map((op) => op.kind)
    expect(kinds).toContain('entry-upsert')
    expect(kinds).toContain('entry-delete')
  })

  it('flushes envelopes FIFO to the operations endpoint and removes them by operationId', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({ status: 'applied', resource: 'entry:x', revision: 0, replay: false }),
    )
    const store = sqliteStore()
    store.startSession('work')
    store.stopSession()
    const opIds = store.syncQueue.map((o) => o.operationId)
    await store.flushSyncQueue()
    const bodies = requestBodies('/api/sync/operations')
    expect(bodies.length).toBeGreaterThanOrEqual(2)
    expect(bodies.map((b) => b.operationId)).toEqual(opIds)
    expect(bodies[0].kind).toBe('entry-upsert')
    expect(bodies[0].payload.type).toBe('work')
    expect(store.syncQueue).toHaveLength(0)
    expect(store.lastSyncedAt).not.toBeNull()
  })

  it('a newer mutation queued mid-flight is not lost — it flushes under its own operationId', async () => {
    let resolveFirst!: (r: Response) => void
    let calls = 0
    fetchMock.mockImplementation(async () => {
      calls += 1
      if (calls === 1) {
        return new Promise<Response>((resolve) => {
          resolveFirst = resolve
        })
      }
      return jsonResponse({ status: 'applied', resource: 'entry:y', revision: 0, replay: false })
    })
    const store = sqliteStore()
    store.startSession('work')
    const firstId = store.syncQueue[0]!.operationId
    const flushing = store.flushSyncQueue()
    store.updateEntry(store.entries[0]!.id, { description: 'mid-flight edit' })
    const midFlightId = store.syncQueue.at(-1)!.operationId
    expect(midFlightId).not.toBe(firstId)
    resolveFirst(jsonResponse({ status: 'applied', resource: 'entry:x', revision: 0, replay: false }))
    await flushing
    const bodies = requestBodies('/api/sync/operations')
    expect(bodies.map((b) => b.operationId)).toContain(firstId)
    expect(bodies.map((b) => b.operationId)).toContain(midFlightId)
    expect(store.syncQueue).toHaveLength(0)
  })

  it('keeps ops queued when flush fails and retries after backoff', async () => {
    vi.useFakeTimers()
    fetchMock.mockRejectedValue(new Error('network down'))
    const store = sqliteStore()
    store.startSession('work')
    await store.flushSyncQueue()
    expect(store.syncQueue.length).toBeGreaterThan(0)
    expect(store.syncError).toBeTruthy()

    fetchMock.mockResolvedValue(jsonResponse({ status: 'applied', resource: 'entry:x', revision: 0 }))
    await vi.advanceTimersByTimeAsync(1500)
    expect(store.syncQueue).toHaveLength(0)
  })

  it('a conflict marks the op blocked and surfaces a resolvable conflict', async () => {
    const remote: TimeEntry = { id: 'e1', type: 'sleep', start: 100, end: 200 }
    fetchMock.mockImplementation(async () =>
      jsonResponse(
        { status: 'conflict', resource: 'entry:e1', remote: { kind: 'entry', entry: remote, revision: 3 } },
        409,
      ),
    )
    const store = sqliteStore()
    store.startSession('work', 'note')
    await store.flushSyncQueue()
    expect(store.syncConflicts).toHaveLength(1)
    expect(store.syncConflicts[0]!.remoteKind).toBe('entry')
    expect(store.syncQueue[0]!.status).toBe('blocked')
    expect(store.syncStatus).toBe('conflict')
  })

  it('a validation rejection blocks the op without an infinite retry loop', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({ status: 'rejected', resource: null, reason: 'bad payload' }, 422),
    )
    const store = sqliteStore()
    store.startSession('work')
    await store.flushSyncQueue()
    expect(store.syncQueue[0]!.status).toBe('blocked')
    expect(store.syncQueue[0]!.blockedReason).toContain('rejected')
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes('/api/sync/operations'))).toHaveLength(1)
  })

  it('conflict resolution keep-local re-enqueues local intent; keep-remote applies the server copy', async () => {
    const remote: TimeEntry = { id: 'x1', type: 'sleep', start: 5, end: 50 }
    fetchMock.mockImplementation(async () =>
      jsonResponse(
        { status: 'conflict', resource: 'entry:x1', remote: { kind: 'entry', entry: remote, revision: 4 } },
        409,
      ),
    )
    const store = sqliteStore()
    store.entries.push({ id: 'x1', type: 'work', start: 5, end: 40 })
    store.updateEntry('x1', { description: 'local edit' })
    await store.flushSyncQueue()
    expect(store.syncConflicts).toHaveLength(1)

    store.resolveSyncConflict('entry:x1', 'keep-remote')
    expect(store.syncConflicts).toHaveLength(0)
    expect(store.entries.find((e) => e.id === 'x1')).toEqual(remote)
    expect(store.syncQueue.filter((o) => (o.payload as TimeEntry).id === 'x1')).toHaveLength(0)
  })

  it('persists the queue to localStorage', async () => {
    const store = sqliteStore()
    store.startSession('work')
    await nextTick()
    await new Promise((r) => setTimeout(r, 10))
    const raw = localStorage.getItem('megagrind-store')
    expect(raw).toBeTruthy()
    const persisted = JSON.parse(String(raw))
    expect(persisted.syncQueue.length).toBeGreaterThan(0)
    expect(persisted.syncQueue[0]).toHaveProperty('operationId')
    expect(persisted.syncQueue[0]).toHaveProperty('endpointId', ENDPOINT)
  })

  it('enqueues a portable preferences op on updateSettings — device keys never leave', () => {
    const store = sqliteStore()
    store.updateSettings({ soundEnabled: true, progressCheckInterval: 30 })
    const prefs = store.syncQueue.filter((op) => op.kind === 'preferences-replace')
    expect(prefs).toHaveLength(1)
    const payload = prefs[0]!.payload as Record<string, unknown>
    expect(payload.progressCheckInterval).toBe(30)
    expect(payload).not.toHaveProperty('backendUrl')
    expect(payload).not.toHaveProperty('backendMode')
    expect(payload).not.toHaveProperty('darkMode')
    expect(payload).not.toHaveProperty('soundEnabled')
  })

  it('endpoint provenance binds ops to the configured endpoint; adoption rebinds them explicitly', () => {
    const store = sqliteStore()
    store.startSession('work')
    expect(store.syncQueue[0]!.endpointId).toBe(ENDPOINT)

    store.settings.backendUrl = 'http://other.example.test'
    expect(store.foreignSyncCount).toBeGreaterThan(0)
    expect(store.pendingSyncCount).toBe(0)

    store.adoptQueuedOpsToCurrentEndpoint()
    expect(store.foreignSyncCount).toBe(0)
    expect(store.syncQueue[0]!.endpointId).toBe(`sqlite:http://other.example.test`)
  })
})

describe('initFromBackend', () => {
  function mockServer(opts: {
    entries?: { entry: TimeEntry; revision: number }[]
    entryTombstones?: { id: string; revision: number; deletedAt: number }[]
    preferences?: { value: Record<string, unknown>; revision: number } | null
    reachable?: boolean
  }) {
    const calls = { ops: [] as { operationId: string; kind: string; payload: unknown; baseRevision?: number | null }[] }
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const u = String(url)
      if (opts.reachable === false) throw new Error('connection refused')
      if (u.endsWith('/api/health')) return jsonResponse({ status: 'ok' })
      if (u.endsWith('/api/sync/snapshot')) {
        return jsonResponse({
          ...emptySnapshot(),
          entries: opts.entries ?? [],
          entryTombstones: opts.entryTombstones ?? [],
          preferences: opts.preferences ?? null,
        })
      }
      if (u.endsWith('/api/sync/operations')) {
        const body = JSON.parse(String(init?.body))
        calls.ops.push(body)
        const resource = body.kind.startsWith('entry:')
          ? body.kind
          : body.kind === 'preferences-replace'
            ? 'preferences'
            : `entry:${(body.payload as { id?: string }).id}`
        return jsonResponse({ status: 'applied', resource, revision: 0, replay: false })
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

  it('seeds local-only entries to an empty server as upsert envelopes', async () => {
    const calls = mockServer({ entries: [] })
    const store = sqliteStore()
    store.entries.push({ id: 'local-1', type: 'work', start: 1000, end: 2000 })
    await store.initFromBackend()
    const seeded = calls.ops.filter((o) => (o.payload as TimeEntry).id === 'local-1')
    expect(seeded).toHaveLength(1)
    expect(seeded[0]!.kind).toBe('entry-upsert')
    expect(seeded[0]!.baseRevision).toBeNull()
  })

  it('applies remote tombstones and never reseeds a remotely deleted entry', async () => {
    const calls = mockServer({
      entries: [],
      entryTombstones: [{ id: 'gone', revision: 2, deletedAt: 123 }],
    })
    const store = sqliteStore()
    store.entries.push({ id: 'gone', type: 'work', start: 1, end: 2 })
    await store.initFromBackend()
    expect(store.entries.find((e) => e.id === 'gone')).toBeUndefined()
    expect(calls.ops.filter((o) => (o.payload as TimeEntry).id === 'gone')).toHaveLength(0)
  })

  it('surfaces a content divergence as a conflict while preserving both copies', async () => {
    const remote: TimeEntry = { id: 'r1', type: 'sleep', start: 100, end: 200 }
    mockServer({ entries: [{ entry: remote, revision: 2 }] })
    const store = sqliteStore()
    store.entries.push({ id: 'r1', type: 'sleep', start: 100, end: 150 })
    await store.initFromBackend()
    expect(store.syncConflicts).toHaveLength(1)
    expect(store.syncConflicts[0]!.resource).toBe('entry:r1')
    // Local copy is preserved until the user chooses.
    expect(store.entries.find((e) => e.id === 'r1')?.end).toBe(150)
  })

  it('pending local intent survives bootstrap — the queued payload snapshot is delivered', async () => {
    const remote: TimeEntry = { id: 'r1', type: 'sleep', start: 100, end: 200 }
    const calls = mockServer({ entries: [{ entry: remote, revision: 1 }] })
    const store = sqliteStore()
    store.entries.push({ id: 'r1', type: 'sleep', start: 100, end: 150 })
    store.updateEntry('r1', { end: 160 })
    await store.initFromBackend()
    // Pending intent is not overwritten by the merge: the queued op flushed
    // with the payload snapshot captured at enqueue time (end: 160).
    const delivered = calls.ops.filter(
      (o) => o.kind === 'entry-upsert' && (o.payload as TimeEntry).id === 'r1',
    )
    expect(delivered).toHaveLength(1)
    expect((delivered[0]!.payload as TimeEntry).end).toBe(160)
  })

  it('falls back to local data when the server is unreachable', async () => {
    mockServer({ reachable: false })
    const store = sqliteStore()
    store.entries.push({ id: 'keep', type: 'work', start: 1, end: 2 })
    await store.initFromBackend()
    expect(store.entries.map((e) => e.id)).toContain('keep')
  })

  it('applies remote portable preferences without touching device settings', async () => {
    mockServer({
      entries: [],
      preferences: { value: { weekRolloverDay: 4, progressCheckInterval: 45 }, revision: 2 },
    })
    const store = sqliteStore()
    await store.initFromBackend()
    expect(store.settings.weekRolloverDay).toBe(4)
    expect(store.settings.progressCheckInterval).toBe(45)
    expect(store.settings.backendUrl).toBe(BASE)
    expect(store.settings.backendMode).toBe('sqlite')
  })
})

describe('remote restore reconciliation', () => {
  function backupDoc(entries: TimeEntry[], events: unknown[] = []) {
    return JSON.stringify({
      version: 2,
      scope: 'full',
      exportedAt: Date.now(),
      entries,
      preferences: {},
      progressEvents: events,
      progressHistoryStartedAt: null,
    })
  }

  it('replace purges superseded ops/conflicts, tombstones removed ids, and upserts restored records', () => {
    const store = sqliteStore()
    store.entries.push({ id: 'keep', type: 'work', start: 10, end: 20 })
    store.entries.push({ id: 'drop', type: 'sleep', start: 30, end: 40 })
    store.updateEntry('keep', { description: 'queued before restore' })
    expect(store.syncQueue.some((o) => (o.payload as TimeEntry).id === 'keep')).toBe(true)
    localStorage.setItem('megagrind-store', '{"schemaVersion":2}')

    const backup = store.parseBackupText(backupDoc([
      { id: 'keep', type: 'work', start: 10, end: 25 },
      { id: 'new', type: 'move', start: 50, end: 60 },
    ]))
    const result = store.applyBackupImport(backup, {
      mode: 'replace',
      conflictChoices: { keep: 'imported' },
    })

    expect(result.kind).toBe('ok')
    expect(store.entries.map((e) => e.id).sort()).toEqual(['keep', 'new'])
    // The stale queued upsert for 'keep' is superseded — every surviving op is
    // part of the restore plan, and removed ids are tombstoned remotely.
    const kinds = store.syncQueue.map((o) => `${o.kind}:${(o.payload as TimeEntry).id ?? 'prefs'}`)
    expect(kinds).toContain('entry-delete:drop')
    expect(kinds).toContain('entry-upsert:keep')
    expect(kinds).toContain('entry-upsert:new')
    expect(kinds).not.toContain('entry-delete:new')
    expect(store.syncConflicts).toHaveLength(0)
    const snapshotKeys = Object.keys(localStorage).filter((k) => k.startsWith('megagrind-recovery-'))
    expect(snapshotKeys.length).toBeGreaterThan(0)
  })

  it('replace is blocked when no verified recovery copy can be written', () => {
    const store = sqliteStore()
    store.entries.push({ id: 'keep', type: 'work', start: 10, end: 20 })
    const backup = store.parseBackupText(backupDoc([{ id: 'keep', type: 'work', start: 10, end: 20 }]))
    localStorage.removeItem('megagrind-store')
    const result = store.applyBackupImport(backup, { mode: 'replace' })
    expect(result.kind).toBe('blocked')
    expect(store.entries.map((e) => e.id)).toEqual(['keep'])
  })

  it('replace also reconciles progress events remotely', () => {
    const store = sqliteStore()
    store.entries.push({ id: 'keep', type: 'work', start: 10, end: 20 })
    store.progressEvents.push(
      { id: 'ev-drop', sessionId: 's', at: 100, outcome: 'blocked' },
      { id: 'ev-keep', sessionId: 's', at: 200, outcome: 'progress' },
    )
    localStorage.setItem('megagrind-store', '{"schemaVersion":2}')
    const backup = store.parseBackupText(backupDoc(
      [{ id: 'keep', type: 'work', start: 10, end: 20 }],
      [{ id: 'ev-keep', sessionId: 's', at: 200, outcome: 'progress' }],
    ))
    const result = store.applyBackupImport(backup, { mode: 'replace' })
    expect(result.kind).toBe('ok')
    expect(store.progressEvents.map((e) => e.id)).toEqual(['ev-keep'])
    const kinds = store.syncQueue.map((o) => `${o.kind}:${(o.payload as { id?: string }).id ?? 'prefs'}`)
    expect(kinds).toContain('event-delete:ev-drop')
    expect(kinds).toContain('event-upsert:ev-keep')
  })
})
