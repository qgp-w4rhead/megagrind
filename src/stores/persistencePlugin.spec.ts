import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { nextTick } from 'vue'
import { createApp } from 'vue'
import { createPinia, disposePinia, setActivePinia, type Pinia } from 'pinia'
import { megagrindPersistencePlugin } from './persistencePlugin'
import { useMegagrindStore } from './megagrind'
import { STORAGE_KEY, SNAPSHOT_KEY_PREFIX } from '../domain/backup'

const extra: Pinia[] = []

function makeStore() {
  const pinia = createPinia()
  pinia.use(megagrindPersistencePlugin)
  createApp({ template: '<div />' }).use(pinia)
  setActivePinia(pinia)
  extra.push(pinia)
  return useMegagrindStore()
}

function snapshotKeys(): string[] {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i)
    if (key?.startsWith(SNAPSHOT_KEY_PREFIX)) keys.push(key)
  }
  return keys
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  extra.splice(0).forEach((pinia) => disposePinia(pinia))
  vi.restoreAllMocks()
})

describe('megagrind persistence plugin', () => {
  it('hydrates an unversioned cache only after capturing the exact pre-migration raw copy', async () => {
    const raw = JSON.stringify({
      entries: [{ id: 'old', type: 'work', start: 1, end: 2 }],
      settings: { darkMode: 'light' },
      syncQueue: [{ kind: 'delete-entry', id: 'pending-delete' }],
    })
    localStorage.setItem(STORAGE_KEY, raw)
    const store = makeStore()
    expect(store.entries).toEqual([{ id: 'old', type: 'work', start: 1, end: 2 }])
    const snapshots = snapshotKeys()
    expect(snapshots).toHaveLength(1)
    expect(localStorage.getItem(snapshots[0]!)).toBe(raw)
    // The migrated cache is normalized to schema version 2 at load; the raw
    // pre-migration copy remains in the recovery snapshot above.
    const migrated = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(migrated.schemaVersion).toBe(2)
    expect(migrated.entries.map((e: { id: string }) => e.id)).toEqual(['old'])
    store.entries.push({ id: 'new', type: 'move', start: 3, end: 4 })
    await nextTick()
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(saved.schemaVersion).toBe(2)
    expect(saved.entries.map((e: { id: string }) => e.id)).toEqual(['old', 'new'])
    // The legacy op hydrated into a blocked envelope; the intent is kept.
    expect(saved.syncQueue).toHaveLength(1)
    expect(saved.syncQueue[0]).toMatchObject({
      kind: 'entry-delete',
      endpointId: null,
      status: 'blocked',
      payload: { id: 'pending-delete' },
    })
  })

  it('leaves invalid stored data untouched and exposes recovery instead of overwriting it', async () => {
    localStorage.setItem(STORAGE_KEY, '{ broken')
    const store = makeStore()
    expect(store.persistenceState).toBe('recovery')
    await nextTick()
    expect(localStorage.getItem(STORAGE_KEY)).toBe('{ broken')
  })

  it('keeps tracking in memory after a storage write failure and persists the same data on retry', async () => {
    const originalSetItem = Storage.prototype.setItem
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === STORAGE_KEY) throw new DOMException('quota', 'QuotaExceededError')
      return originalSetItem.call(this, key, value)
    })
    const store = makeStore()
    store.entries.push({ id: 'memory', type: 'work', start: 1, end: 2 })
    await nextTick()
    expect(store.persistenceState).toBe('memory')
    expect(store.entries.map((e) => e.id)).toEqual(['memory'])
    setItem.mockRestore()
    store.retryPersistence()
    expect(store.persistenceState).toBe('ready')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).entries[0].id).toBe('memory')
  })

  it('writes a versioned snapshot for domain mutations without persisting clock ticks', async () => {
    const store = makeStore()
    const initial = localStorage.getItem(STORAGE_KEY)
    store.$persist()
    expect(localStorage.getItem(STORAGE_KEY)).toBe(initial)
    store.entries.push({ id: 'new', type: 'sleep', start: 1, end: 2 })
    await nextTick()
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(saved.schemaVersion).toBe(2)
    expect(saved.entries.map((e: { id: string }) => e.id)).toEqual(['new'])
  })

  it('blocks a replace restore when a verified same-browser recovery snapshot cannot be written', () => {
    const store = makeStore()
    store.entries.push({ id: 'local', type: 'work', start: 1, end: 2 })
    store.$persist()
    const backup = store.parseBackupText(JSON.stringify(store.exportFullBackup()))
    backup.entries = []
    const originalSetItem = Storage.prototype.setItem
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key.startsWith(SNAPSHOT_KEY_PREFIX)) throw new DOMException('quota', 'QuotaExceededError')
      return originalSetItem.call(this, key, value)
    })
    const result = store.applyBackupImport(backup, { mode: 'replace' })
    expect(result).toMatchObject({ kind: 'blocked', needs: 'snapshot' })
    expect(store.entries.map((e) => e.id)).toEqual(['local'])
    setItem.mockRestore()
  })
})
