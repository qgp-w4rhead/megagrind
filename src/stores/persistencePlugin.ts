import { watch, type WatchStopHandle } from 'vue'
import type { PiniaPluginContext, Store } from 'pinia'
import { decodeStoredCache, encodeStoredSnapshot, type StoredSnapshotV2 } from '../domain/persistenceCodec'
import { STORAGE_KEY, writeRecoverySnapshot, type PersistenceState, type StorageLike } from '../domain/backup'

type PersistedDomain = {
  entries: unknown[]
  settings: unknown
  progressCheck: unknown
  progressEvents: unknown[]
  progressHistoryStartedAt: number | null
  syncQueue: unknown[]
  remoteRevisions: Record<string, number>
  remoteTombstones: Record<string, number>
  lastSyncedAt: number | null
}

type PersistedStore = Store<'megagrind'> & PersistedDomain & {
  persistenceState: PersistenceState
  persistenceError: string | null
  lastSavedPayload: string
  retryPersistence: () => void
  markPersistenceResult: (state: PersistenceState, error?: string | null) => void
  $persist: () => void
  $hydrate: () => void
  __persistenceRetry?: () => void
}

function browserStorage(): StorageLike | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

function dataClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function snapshotFrom(store: PersistedStore): StoredSnapshotV2 {
  return {
    schemaVersion: 2,
    entries: dataClone(store.entries) as StoredSnapshotV2['entries'],
    settings: dataClone(store.settings) as StoredSnapshotV2['settings'],
    progressCheck: dataClone(store.progressCheck) as StoredSnapshotV2['progressCheck'],
    progressEvents: dataClone(store.progressEvents) as StoredSnapshotV2['progressEvents'],
    progressHistoryStartedAt: store.progressHistoryStartedAt,
    syncQueue: dataClone(store.syncQueue) as StoredSnapshotV2['syncQueue'],
    remoteRevisions: { ...store.remoteRevisions },
    remoteTombstones: { ...store.remoteTombstones },
    lastSyncedAt: store.lastSyncedAt,
  }
}

function applySnapshot(store: PersistedStore, snapshot: StoredSnapshotV2) {
  store.entries = snapshot.entries
  store.settings = snapshot.settings
  store.progressCheck = snapshot.progressCheck
  store.progressEvents = snapshot.progressEvents
  store.progressHistoryStartedAt = snapshot.progressHistoryStartedAt
  store.syncQueue = snapshot.syncQueue
  store.remoteRevisions = snapshot.remoteRevisions
  store.remoteTombstones = snapshot.remoteTombstones
  store.lastSyncedAt = snapshot.lastSyncedAt
}

export function megagrindPersistencePlugin({ store }: PiniaPluginContext) {
  if (store.$id !== 'megagrind') return
  const target = store as unknown as PersistedStore
  const storage = browserStorage()
  let hydrated = false
  let stop: WatchStopHandle | null = null

  function mark(state: PersistenceState, error: string | null = null) {
    target.persistenceState = state
    target.persistenceError = error
  }

  function persist() {
    if (!hydrated || !storage) {
      if (!storage) mark('memory', 'Browser storage is unavailable. Changes are kept in memory only until you leave this page.')
      return
    }
    const payload = encodeStoredSnapshot(snapshotFrom(target))
    if (payload === target.lastSavedPayload) return
    try {
      storage.setItem(STORAGE_KEY, payload)
      const written = storage.getItem(STORAGE_KEY)
      if (written !== payload) throw new Error('Browser storage did not keep the saved snapshot')
      target.lastSavedPayload = payload
      mark('ready')
    } catch (err) {
      mark('memory', err instanceof Error ? err.message : 'Browser storage could not save changes')
    }
  }

  function hydrate() {
    if (!storage) {
      mark('memory', 'Browser storage is unavailable. Changes are kept in memory only until you leave this page.')
      hydrated = true
      target.lastSavedPayload = encodeStoredSnapshot(snapshotFrom(target))
      return
    }
    let raw: string | null = null
    try {
      raw = storage.getItem(STORAGE_KEY)
    } catch (err) {
      mark('recovery', err instanceof Error ? err.message : 'Browser storage could not be read')
      hydrated = true
      target.lastSavedPayload = encodeStoredSnapshot(snapshotFrom(target))
      return
    }
    const decoded = decodeStoredCache(raw)
    if (decoded.kind === 'empty') {
      mark('ready')
      target.lastSavedPayload = ''
      hydrated = true
      persist()
      return
    }
    if (decoded.kind === 'recovery') {
      mark('recovery', decoded.reason)
      hydrated = true
      target.lastSavedPayload = encodeStoredSnapshot(snapshotFrom(target))
      return
    }
    if (decoded.sourceVersion === 1 && raw !== null) {
      const key = writeRecoverySnapshot(storage, raw)
      if (key === null) {
        mark('recovery', 'A pre-migration recovery copy could not be saved, so stored data was left untouched.')
        hydrated = true
        target.lastSavedPayload = encodeStoredSnapshot(snapshotFrom(target))
        return
      }
    }
    // Carry unclosed local records the stored snapshot does not know about:
    // a shared-storage writer must not silently erase a session this tab is
    // still running. Carried opens reappear as a multiple-open conflict that
    // the user reconciles explicitly.
    const storedIds = new Set(decoded.snapshot.entries.map((e) => e.id))
    const carried = (target.entries as StoredSnapshotV2['entries'])
      .filter((e) => e.end === null && !storedIds.has(e.id))
    const snapshot = carried.length > 0
      ? {
          ...decoded.snapshot,
          entries: [...decoded.snapshot.entries, ...dataClone(carried)]
            .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id)),
        }
      : decoded.snapshot
    applySnapshot(target, snapshot)
    hydrated = true
    // Keeping the raw string as last-saved lets the watcher persist a merged
    // snapshot once instead of comparing against a re-encode of the old one.
    target.lastSavedPayload = raw ?? encodeStoredSnapshot(snapshot)
    if (decoded.sourceVersion === 1 || carried.length > 0) persist()
    else mark('ready')
  }

  target.persistenceState = 'ready'
  target.persistenceError = null
  target.lastSavedPayload = ''
  target.markPersistenceResult = mark
  target.__persistenceRetry = () => {
    hydrate()
    persist()
  }
  const originalRetry = target.retryPersistence.bind(target)
  target.retryPersistence = () => {
    originalRetry()
    target.__persistenceRetry?.()
  }
  target.$hydrate = hydrate
  target.$persist = persist

  hydrate()
  stop = watch(
    () => [target.entries, target.settings, target.progressCheck, target.progressEvents, target.progressHistoryStartedAt, target.syncQueue, target.remoteRevisions, target.remoteTombstones, target.lastSyncedAt],
    () => persist(),
    { deep: true },
  )

  if (import.meta.hot) import.meta.hot.on('vite:beforeFullReload', () => stop?.())
  const originalDispose = target.$dispose.bind(target)
  target.$dispose = () => {
    stop?.()
    originalDispose()
  }
}

export function makeDownload(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function downloadRecoveryCopy(): boolean {
  const storage = browserStorage()
  const raw = storage?.getItem(STORAGE_KEY)
  if (!raw) return false
  makeDownload(`megagrind-recovery-${new Date().toISOString().slice(0, 19).replaceAll(':', '-')}.json`, raw)
  return true
}
