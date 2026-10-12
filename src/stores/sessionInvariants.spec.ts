import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { useMegagrindStore } from './megagrind'
import type { TimeEntry } from '../types'

function openEntry(id: string, type: string, start: number): TimeEntry {
  return { id, type, start, end: null }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-11T12:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('session invariants', () => {
  it('closes the previous open entry at the same timestamp the next one starts', () => {
    const store = useMegagrindStore()
    store.startSession('work')
    const workId = store.entries.find((e) => e.type === 'work')!.id
    vi.setSystemTime(new Date('2026-10-11T12:30:00Z'))
    store.startSession('leisure')
    const work = store.entries.find((e) => e.id === workId)!
    const leisure = store.entries.find((e) => e.type === 'leisure')!
    expect(work.end).toBe(leisure.start)
    expect(work.end).toBe(Date.parse('2026-10-11T12:30:00Z'))
    expect(store.openEntries.map((e) => e.id)).toEqual([leisure.id])
  })

  it('a rapid double start leaves exactly one running entry', () => {
    const store = useMegagrindStore()
    store.startSession('work')
    store.startSession('chores')
    expect(store.openEntries).toHaveLength(1)
    expect(store.openEntries[0]!.type).toBe('chores')
  })

  it('startSession closes every open entry so a stale second record cannot stay running', () => {
    const store = useMegagrindStore()
    store.entries.push(openEntry('a', 'work', 1), openEntry('b', 'chores', 2))
    store.startSession('move')
    const opens = store.openEntries
    expect(opens).toHaveLength(1)
    expect(opens[0]!.type).toBe('move')
    const moved = opens[0]!
    for (const id of ['a', 'b']) {
      const entry = store.entries.find((e) => e.id === id)!
      expect(entry.end).toBe(moved.start)
    }
  })

  it('stopSession closes all open activities and leaves a single idle entry', () => {
    const store = useMegagrindStore()
    store.entries.push(openEntry('a', 'work', 1), openEntry('b', 'chores', 2))
    vi.setSystemTime(new Date('2026-10-11T13:00:00Z'))
    store.stopSession()
    const opens = store.openEntries
    expect(opens).toHaveLength(1)
    expect(opens[0]!.type).toBe('idle')
    for (const id of ['a', 'b']) {
      expect(store.entries.find((e) => e.id === id)!.end).toBe(Date.parse('2026-10-11T13:00:00Z'))
    }
  })

  it('stopSession keeps an existing open idle entry instead of duplicating it', () => {
    const store = useMegagrindStore()
    store.entries.push(openEntry('a', 'work', 1), openEntry('idle-1', 'idle', 2))
    store.stopSession()
    const opens = store.openEntries
    expect(opens).toHaveLength(1)
    expect(opens[0]!.id).toBe('idle-1')
    expect(store.entries.filter((e) => e.type === 'idle')).toHaveLength(1)
  })

  it('stopSession creates no idle entry when idle tracking is disabled', () => {
    const store = useMegagrindStore()
    store.settings.idleTimeEnabled = false
    store.startSession('work')
    store.stopSession()
    expect(store.openEntries).toHaveLength(0)
    expect(store.entries.every((e) => e.type !== 'idle')).toBe(true)
  })

  it('initIdle starts tracking only when nothing is open', () => {
    const store = useMegagrindStore()
    store.initIdle()
    expect(store.openEntries.map((e) => e.type)).toEqual(['idle'])
    store.initIdle()
    expect(store.openEntries).toHaveLength(1)
  })

  it('initIdle never creates an idle entry over a restored running session', () => {
    const store = useMegagrindStore()
    store.entries.push(openEntry('running', 'work', 1))
    store.initIdle()
    expect(store.openEntries.map((e) => e.id)).toEqual(['running'])
    expect(store.entries.every((e) => e.type !== 'idle')).toBe(true)
  })

  it('disabling idle tracking closes the open idle entry', async () => {
    const store = useMegagrindStore()
    store.initIdle()
    const idle = store.openEntries[0]!
    store.settings.idleTimeEnabled = false
    await nextTick()
    expect(store.entries.find((e) => e.id === idle.id)!.end).toBe(Date.now())
    expect(store.openEntries).toHaveLength(0)
  })

  it('enabling idle tracking with nothing running applies the same invariant as load', async () => {
    const store = useMegagrindStore()
    store.settings.idleTimeEnabled = false
    await nextTick()
    store.settings.idleTimeEnabled = true
    await nextTick()
    expect(store.openEntries.map((e) => e.type)).toEqual(['idle'])
  })

  it('enabling idle tracking while a session runs does not open a second entry', async () => {
    const store = useMegagrindStore()
    store.entries.push(openEntry('running', 'work', 1))
    store.settings.idleTimeEnabled = false
    await nextTick()
    store.settings.idleTimeEnabled = true
    await nextTick()
    expect(store.openEntries.map((e) => e.id)).toEqual(['running'])
  })

  it('multiple open entries surface a conflict until the user chooses one', () => {
    const store = useMegagrindStore()
    store.entries.push(openEntry('older', 'work', 100), openEntry('newer', 'chores', 200))
    expect(store.openSessionConflict).toBe(true)
    expect(store.resolveOpenEntries('newer')).toBeNull()
    const older = store.entries.find((e) => e.id === 'older')!
    const newer = store.entries.find((e) => e.id === 'newer')!
    expect(older.end).toBe(200)
    expect(newer.end).toBeNull()
    expect(store.openSessionConflict).toBe(false)
  })

  it('keeping the older open entry closes the later one at its own start', () => {
    const store = useMegagrindStore()
    store.entries.push(openEntry('older', 'work', 100), openEntry('newer', 'chores', 200))
    expect(store.resolveOpenEntries('older')).toBeNull()
    expect(store.entries.find((e) => e.id === 'newer')!.end).toBe(200)
    expect(store.openEntries.map((e) => e.id)).toEqual(['older'])
  })

  it('ending all open entries closes them at the clock without deleting records', () => {
    const store = useMegagrindStore()
    store.entries.push(openEntry('a', 'work', 100), openEntry('b', 'chores', 200))
    vi.setSystemTime(new Date('2026-10-11T14:00:00Z'))
    expect(store.resolveOpenEntries(null)).toBeNull()
    expect(store.openEntries).toHaveLength(0)
    expect(store.entries.find((e) => e.id === 'a')!.end).toBe(Date.parse('2026-10-11T14:00:00Z'))
    expect(store.entries.find((e) => e.id === 'b')!.end).toBe(Date.parse('2026-10-11T14:00:00Z'))
  })

  it('resolveOpenEntries rejects an id that is not among the open entries', () => {
    const store = useMegagrindStore()
    store.entries.push(openEntry('a', 'work', 100), openEntry('b', 'chores', 200))
    expect(store.resolveOpenEntries('missing')).toBe('Choose one of the running entries.')
    expect(store.openSessionConflict).toBe(true)
  })

  it('reconciliation enqueues upserts for every closed entry in sqlite mode', () => {
    const store = useMegagrindStore()
    store.settings.backendMode = 'sqlite'
    store.entries.push(openEntry('a', 'work', 100), openEntry('b', 'chores', 200))
    store.resolveOpenEntries('b')
    const upserts = store.syncQueue.filter((op) => op.kind === 'entry-upsert')
    expect(upserts.map((op) => (op.payload as TimeEntry).id)).toEqual(['a'])
    expect((upserts[0]!.payload as TimeEntry).end).toBe(200)
  })

  it('a session open longer than the stale threshold is flagged for review', () => {
    const store = useMegagrindStore()
    const staleStart = Date.now() - store.STALE_SESSION_MS - 1
    store.entries.push(openEntry('forgotten', 'work', staleStart))
    expect(store.forgottenEntry?.id).toBe('forgotten')
  })

  it('recent and idle open entries are not flagged as forgotten', () => {
    const store = useMegagrindStore()
    store.entries.push(
      openEntry('recent', 'work', Date.now() - 60_000),
      { id: 'long-idle', type: 'idle', start: Date.now() - store.STALE_SESSION_MS - 1, end: null },
    )
    expect(store.forgottenEntry).toBeNull()
  })

  it('a running session restored from persisted entries keeps running after load', () => {
    const store = useMegagrindStore()
    store.entries.push(openEntry('persisted', 'work', Date.now() - 3_600_000))
    expect(store.activeSession.type).toBe('work')
    expect(store.getCurrentSessionDuration()).toBe(3_600_000)
  })
})
