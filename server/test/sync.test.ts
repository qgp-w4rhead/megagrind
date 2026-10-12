import { describe, it, expect } from 'vitest'
import type { Hono } from 'hono'
import { createTestApp, makeEntry } from './helpers.js'

function post(app: Hono, body: unknown) {
  return app.request('/api/sync/operations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function snapshot(app: Hono) {
  return app.request('/api/sync/snapshot')
}

function upsertOp(id: string, entry: unknown, baseRevision: number | null = null) {
  return { operationId: id, kind: 'entry-upsert', baseRevision, payload: entry }
}

describe('sync snapshot', () => {
  it('returns a protocol-1 snapshot with empty collections on a fresh database', async () => {
    const { app } = await createTestApp()
    const res = await snapshot(app)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.protocol).toBe(1)
    expect(data.entries).toEqual([])
    expect(data.entryTombstones).toEqual([])
    expect(data.preferences).toBeNull()
    expect(data.progressEvents).toEqual([])
    expect(data.eventTombstones).toEqual([])
  })

  it('does not expose device-only settings keys in transported preferences', async () => {
    const { app } = await createTestApp()
    await app.request('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        weeklyAllocations: { sleep: 49 },
        customChronos: [],
        choreCategories: ['laundry'],
        workCategories: ['dev'],
        weekRolloverDay: 1,
        weekRolloverHour: 6,
        notificationsEnabled: true,
        soundEnabled: true,
        focusModeDuration: 60,
        progressCheckInterval: 20,
        darkMode: 'dark',
        backendMode: 'sqlite',
        backendUrl: 'http://secret-internal-host:3000',
        idleTimeEnabled: false,
        progressCheckEnabled: true,
      }),
    })
    const res = await snapshot(app)
    const data = await res.json()
    expect(data.preferences).not.toBeNull()
    expect(data.preferences.value).not.toHaveProperty('backendUrl')
    expect(data.preferences.value).not.toHaveProperty('backendMode')
    expect(data.preferences.value).not.toHaveProperty('darkMode')
    expect(data.preferences.value).not.toHaveProperty('soundEnabled')
    expect(data.preferences.value.weekRolloverDay).toBe(1)
  })
})

describe('sync operations', () => {
  it('rejects malformed envelopes with 400', async () => {
    const { app } = await createTestApp()
    for (const body of [
      {},
      { operationId: '', kind: 'entry-upsert', baseRevision: null, payload: {} },
      { operationId: 'x', kind: 'nonsense', baseRevision: null, payload: {} },
      { operationId: 'x', kind: 'entry-upsert', baseRevision: -2, payload: {} },
    ]) {
      const res = await post(app, body)
      expect(res.status).toBe(400)
    }
  })

  it('applies a new entry at revision 0', async () => {
    const { app } = await createTestApp()
    const entry = makeEntry({ id: 'e1' })
    const res = await post(app, upsertOp('op-1', entry))
    expect(res.status).toBe(200)
    const ack = await res.json()
    expect(ack.status).toBe('applied')
    expect(ack.resource).toBe('entry:e1')
    expect(ack.revision).toBe(0)

    const data = await (await snapshot(app)).json()
    expect(data.entries).toHaveLength(1)
    expect(data.entries[0].entry.id).toBe('e1')
    expect(data.entries[0].revision).toBe(0)
  })

  it('replays an identical operation idempotently without duplicating state', async () => {
    const { app } = await createTestApp()
    const entry = makeEntry({ id: 'e1' })
    const first = await post(app, upsertOp('op-1', entry))
    expect((await first.clone().json()).status).toBe('applied')
    const replay = await post(app, upsertOp('op-1', entry))
    const ack = await replay.json()
    expect(ack.replay).toBe(true)
    expect(ack.status).toBe('applied')
    expect(ack.revision).toBe(0)
    const data = await (await snapshot(app)).json()
    expect(data.entries).toHaveLength(1)
    expect(data.entries[0].revision).toBe(0)
  })

  it('rejects operationId reuse with different content', async () => {
    const { app } = await createTestApp()
    await post(app, upsertOp('op-1', makeEntry({ id: 'e1' })))
    const res = await post(app, upsertOp('op-1', makeEntry({ id: 'different' })))
    expect(res.status).toBe(422)
    const ack = await res.json()
    expect(ack.status).toBe('rejected')
  })

  it('compare-and-swap: a stale baseRevision produces a conflict with remote state', async () => {
    const { app } = await createTestApp()
    const entry = makeEntry({ id: 'e1' })
    await post(app, upsertOp('op-1', entry)) // rev 0
    const stale = await post(app, upsertOp('op-2', { ...entry, description: 'stale write' }, 5))
    expect(stale.status).toBe(409)
    const conflict = await stale.json()
    expect(conflict.status).toBe('conflict')
    expect(conflict.remote.kind).toBe('entry')
    expect(conflict.remote.revision).toBe(0)

    const ok = await post(app, upsertOp('op-3', { ...entry, description: 'fresh write' }, 0))
    expect(ok.status).toBe(200)
    expect((await ok.json()).revision).toBe(1)
  })

  it('an upsert claiming a missing resource conflicts when the server already has it', async () => {
    const { app } = await createTestApp()
    await post(app, upsertOp('op-1', makeEntry({ id: 'e1' })))
    const res = await post(app, upsertOp('op-2', makeEntry({ id: 'e1', type: 'sleep' }), null))
    expect(res.status).toBe(409)
  })

  it('delete writes a tombstone and repeat deletes acknowledge without resurrecting', async () => {
    const { app } = await createTestApp()
    const entry = makeEntry({ id: 'e1' })
    await post(app, upsertOp('op-1', entry)) // rev 0
    const del = await post(app, { operationId: 'op-2', kind: 'entry-delete', baseRevision: 0, payload: { id: 'e1' } })
    expect(del.status).toBe(200)
    expect((await del.json()).revision).toBe(1)

    let data = await (await snapshot(app)).json()
    expect(data.entries).toHaveLength(0)
    expect(data.entryTombstones).toHaveLength(1)
    expect(data.entryTombstones[0].id).toBe('e1')
    expect(data.entryTombstones[0].revision).toBe(1)

    const again = await post(app, { operationId: 'op-3', kind: 'entry-delete', baseRevision: 1, payload: { id: 'e1' } })
    expect(again.status).toBe(200)
    const againAck = await again.json()
    expect(againAck.status).toBe('applied')
    expect(againAck.tombstoned).toBe(true)

    data = await (await snapshot(app)).json()
    expect(data.entryTombstones).toHaveLength(1)
  })

  it('a plain upsert cannot resurrect a tombstoned entry; an explicit restore can', async () => {
    const { app } = await createTestApp()
    const entry = makeEntry({ id: 'e1' })
    await post(app, upsertOp('op-1', entry))
    await post(app, { operationId: 'op-2', kind: 'entry-delete', baseRevision: 0, payload: { id: 'e1' } })

    const stale = await post(app, upsertOp('op-3', entry, 0))
    expect(stale.status).toBe(409)
    const conflict = await stale.json()
    expect(conflict.remote.kind).toBe('tombstone')
    expect(conflict.remote.tombstone.revision).toBe(1)

    const restore = await post(app, {
      operationId: 'op-4',
      kind: 'entry-restore',
      baseRevision: 1,
      payload: entry,
    })
    expect(restore.status).toBe(200)
    expect((await restore.json()).revision).toBe(2)
    const data = await (await snapshot(app)).json()
    expect(data.entries).toHaveLength(1)
    expect(data.entryTombstones).toHaveLength(0)
  })

  it('legacy CRUD advances the same revision and tombstone state', async () => {
    const { app } = await createTestApp()
    const entry = makeEntry({ id: 'e1' })
    await app.request('/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    })
    let data = await (await snapshot(app)).json()
    expect(data.entries[0].revision).toBe(0)

    await app.request('/api/entries/e1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'edited' }),
    })
    data = await (await snapshot(app)).json()
    expect(data.entries[0].revision).toBe(1)

    await app.request('/api/entries/e1', { method: 'DELETE' })
    data = await (await snapshot(app)).json()
    expect(data.entries).toHaveLength(0)
    expect(data.entryTombstones[0].revision).toBe(2)

    // A sync client that believed revision 0 conflicts instead of silently resurrecting.
    const res = await post(app, upsertOp('op-late', entry, 0))
    expect(res.status).toBe(409)
    expect((await res.json()).remote.kind).toBe('tombstone')
  })

  it('preferences replace follows compare-and-swap and stays portable-only', async () => {
    const { app } = await createTestApp()
    const put = await post(app, {
      operationId: 'op-p1',
      kind: 'preferences-replace',
      baseRevision: null,
      payload: { weekRolloverDay: 3, focusModeDuration: 90 },
    })
    expect(put.status).toBe(200)

    const data = await (await snapshot(app)).json()
    expect(data.preferences.value.weekRolloverDay).toBe(3)

    const deviceKey = await post(app, {
      operationId: 'op-p2',
      kind: 'preferences-replace',
      baseRevision: 0,
      payload: { backendUrl: 'http://other:3000' },
    })
    expect(deviceKey.status).toBe(422)

    const stale = await post(app, {
      operationId: 'op-p3',
      kind: 'preferences-replace',
      baseRevision: 9,
      payload: { weekRolloverDay: 4 },
    })
    expect(stale.status).toBe(409)
    expect((await stale.json()).remote.kind).toBe('preferences')
  })

  it('progress events merge by id: identical repeats are harmless, divergent ids rejected', async () => {
    const { app } = await createTestApp()
    const event = { id: 'ev1', sessionId: 's1', at: 1_700_000_000_000, outcome: 'progress' }
    const first = await post(app, { operationId: 'op-e1', kind: 'event-upsert', baseRevision: null, payload: event })
    expect(first.status).toBe(200)

    const same = await post(app, { operationId: 'op-e2', kind: 'event-upsert', baseRevision: null, payload: event })
    expect(same.status).toBe(200)
    expect((await same.json()).status).toBe('applied')

    const divergent = await post(app, {
      operationId: 'op-e3',
      kind: 'event-upsert',
      baseRevision: null,
      payload: { ...event, outcome: 'blocked' },
    })
    expect(divergent.status).toBe(422)

    const data = await (await snapshot(app)).json()
    expect(data.progressEvents).toHaveLength(1)
    expect(data.progressEvents[0].event.outcome).toBe('progress')
  })
})
