import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useMegagrindStore } from './megagrind'
import type { TimeEntry } from '../types'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('restoreEntry (undo of a delete)', () => {
  it('restores the exact original record under the same id and queues an upsert', () => {
    const store = useMegagrindStore()
    store.settings.backendMode = 'sqlite'
    const original: TimeEntry = { id: 'e1', type: 'work', start: 1000, end: 5000, description: 'draft', balancedWith: 'e2' }
    store.entries.push({ ...original })
    const snapshot = { ...store.entries[0]! }
    store.deleteEntry('e1')
    expect(store.entries).toHaveLength(0)
    store.restoreEntry(snapshot)
    expect(store.entries).toHaveLength(1)
    expect(store.entries[0]).toEqual(original)
    expect(store.syncQueue).toContainEqual({ kind: 'upsert-entry', entry: original })
  })

  it('rejects restoring a running entry while another entry is running, without changing entries', () => {
    const store = useMegagrindStore()
    store.settings.backendMode = 'sqlite'
    store.entries.push({ id: 'live', type: 'move', start: 1000, end: null })
    const error = store.restoreEntry({ id: 'old', type: 'work', start: 500, end: null })
    expect(error).toContain('Another activity is running')
    expect(store.entries.map((e) => e.id)).toEqual(['live'])
  })
})
