import { defineStore } from 'pinia'
import { ref, computed, watch, onScopeDispose } from 'vue'
import type { TimeEntry, TimeRange, EntrySlice, TrackerType, WorkCategory, Settings, WeekData, SyncEnvelope, SyncOpKind, SyncConflictInfo, SyncStatus, ProgressEvent, Goal } from '../types'
import { applyImport, decodeImportDocument, makeFullBackup, makePeriodReport, previewImport, STORAGE_KEY, writeRecoverySnapshot, type FullBackupV2, type ImportApplyOptions, type ImportApplyResult, type ImportPreview, type PersistenceState } from '../domain/backup'
import { DEFAULT_SETTINGS, DEFAULT_CHORE_CATEGORIES, DEFAULT_WORK_CATEGORIES, buildDefaultActivities, createDefaultSettings } from '../types'
import { activityDefinitions } from '../domain/activities'
import { ApiError, useApi } from '../composables/useApi'
import {
  endpointIdFor,
  mergeSnapshotEntries,
  portablePreferencesOf,
  preferencesFingerprint,
  resourceOf,
  type SyncRemoteState,
  type SyncSnapshot,
} from '../domain/sync'
import { sliceEntries, totalDuration, coveredDuration, dayRange, weekRange } from '../domain/time'
import {
  PROGRESS_DEFAULTS,
  reconcileProgressState,
  answerProgressState,
  snoozeProgressState,
  enableFocusState,
  disableFocusState,
  applyIntervalState,
  type ProgressContext,
  type ProgressState,
} from '../domain/progressSchedule'

function normalizeLegacyAllocations(source: Record<string, number>): Record<string, number> {
  const copy: Record<string, number> = { ...source }
  const hasLegacy = Object.prototype.hasOwnProperty.call(copy, 'laundry') || Object.prototype.hasOwnProperty.call(copy, 'dishes')
  const chores = hasLegacy ? (copy.laundry ?? 0) + (copy.dishes ?? 0) : DEFAULT_SETTINGS.weeklyAllocations.chores!
  delete copy.laundry
  delete copy.dishes
  return { ...DEFAULT_SETTINGS.weeklyAllocations, ...copy, chores }
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`
}

export const useMegagrindStore = defineStore('megagrind', () => {
  const entries = ref<TimeEntry[]>([])
  const settings = ref<Settings>(createDefaultSettings())
  const progressCheck = ref<ProgressState>({ ...PROGRESS_DEFAULTS })
  const progressEvents = ref<ProgressEvent[]>([])
  const progressHistoryStartedAt = ref<number | null>(null)
  const api = useApi()
  const persistenceState = ref<PersistenceState>('ready')
  const persistenceError = ref<string | null>(null)
  const lastSavedPayload = ref('')

  function markPersistenceResult(state: PersistenceState, error: string | null = null) {
    persistenceState.value = state
    persistenceError.value = error
  }

  const persistenceSaveWarning = 'Storage is unavailable right now, so this change is held in memory only.'
  function saveSucceeded(action: string): string {
    return persistenceState.value === 'ready' ? `${action} saved.` : `${action} changed in memory only. ${persistenceSaveWarning}`
  }

  function retryPersistence() {
    persistenceState.value = 'ready'
    persistenceError.value = null
  }

  // ------------------------------------------------------------------
  // Sync outbox (protocol 1): every local mutation becomes an immutable
  // envelope carrying an operationId, the endpoint it was captured for,
  // and a payload snapshot. Envelopes flush FIFO to the revisioned sync
  // endpoint; an acknowledged operation is removed by its exact ID so a
  // change queued mid-flight is never lost or mis-acked.
  // ------------------------------------------------------------------
  const syncQueue = ref<SyncEnvelope[]>([])
  const remoteRevisions = ref<Record<string, number>>({})
  const remoteTombstones = ref<Record<string, number>>({})
  const lastSyncedAt = ref<number | null>(null)
  const syncConflicts = ref<SyncConflictInfo[]>([])
  const syncError = ref<string | null>(null)
  const syncBusy = ref(false)
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let retryDelayMs = 1000
  let backendWatchStarted = false
  let bootstrapping = false
  let lastPrefsFingerprint = preferencesFingerprint(settings.value)

  function currentEndpointId(): string | null {
    if (settings.value.backendMode !== 'sqlite') return null
    const origin = typeof window !== 'undefined' ? window.location.origin : 'same-origin'
    return endpointIdFor(settings.value.backendMode, settings.value.backendUrl, origin)
  }

  const pendingSyncCount = computed(
    () => syncQueue.value.filter((o) => o.status === 'pending' && o.endpointId === currentEndpointId()).length,
  )
  // Ops bound to a different endpoint than the active configuration. They
  // keep their provenance and can only be sent after an explicit adoption.
  const foreignSyncCount = computed(
    () => syncQueue.value.filter((o) => o.endpointId !== currentEndpointId()).length,
  )
  const blockedSyncCount = computed(
    () => syncQueue.value.filter((o) => o.status === 'blocked' && o.endpointId === currentEndpointId()).length,
  )

  const syncStatus = computed<SyncStatus>(() => {
    if (settings.value.backendMode !== 'sqlite') return 'local'
    if (syncConflicts.value.length > 0) return 'conflict'
    if (blockedSyncCount.value > 0) return 'failed'
    if (syncBusy.value) return 'syncing'
    if (syncError.value) return api.isBackendAvailable.value ? 'failed' : 'offline'
    if (pendingSyncCount.value > 0 || foreignSyncCount.value > 0) {
      return api.isBackendAvailable.value ? 'pending' : 'offline'
    }
    return 'synced'
  })

  function enqueueSync(kind: SyncOpKind, payload: unknown) {
    if (settings.value.backendMode !== 'sqlite') return
    syncQueue.value.push({
      operationId: generateId(),
      endpointId: currentEndpointId(),
      kind,
      payload: JSON.parse(JSON.stringify(payload)) as unknown,
      baseRevision: null,
      status: 'pending',
      blockedReason: null,
      attempts: 0,
    })
    scheduleFlush()
  }

  function enqueueEntryUpsert(id: string) {
    const entry = entries.value.find((e) => e.id === id)
    if (entry) enqueueSync('entry-upsert', entry)
  }

  function enqueuePreferences() {
    const fingerprint = preferencesFingerprint(settings.value)
    if (fingerprint === lastPrefsFingerprint) return
    lastPrefsFingerprint = fingerprint
    enqueueSync('preferences-replace', portablePreferencesOf(settings.value))
  }

  function scheduleFlush() {
    if (settings.value.backendMode !== 'sqlite') return
    if (flushTimer) return
    flushTimer = setTimeout(() => {
      flushTimer = null
      void flushSyncQueue()
    }, 100)
  }

  function scheduleRetry() {
    if (retryTimer) return
    const delay = retryDelayMs
    retryDelayMs = Math.min(retryDelayMs * 2, 30000)
    retryTimer = setTimeout(() => {
      retryTimer = null
      void flushSyncQueue()
    }, delay)
  }

  function applyAck(ack: { resource: string | null; revision?: number; tombstoned?: boolean }) {
    if (ack.resource && ack.revision !== undefined) {
      if (ack.tombstoned) {
        remoteTombstones.value[ack.resource] = ack.revision
        delete remoteRevisions.value[ack.resource]
      } else {
        remoteRevisions.value[ack.resource] = ack.revision
        delete remoteTombstones.value[ack.resource]
      }
    }
    lastSyncedAt.value = Date.now()
    syncError.value = null
    retryDelayMs = 1000
  }

  function conflictLabel(kind: SyncOpKind): string {
    switch (kind) {
      case 'entry-upsert': return 'Entry update'
      case 'entry-delete': return 'Entry delete'
      case 'entry-restore': return 'Entry restore'
      case 'preferences-replace': return 'Preferences'
      case 'event-upsert': return 'Progress event'
      case 'event-delete': return 'Progress event delete'
    }
  }

  function upsertConflict(info: SyncConflictInfo) {
    syncConflicts.value = [
      ...syncConflicts.value.filter((c) => c.resource !== info.resource),
      info,
    ]
  }

  function recordOpConflict(op: SyncEnvelope, remote: SyncRemoteState | undefined, kind: SyncOpKind) {
    const resource = resourceOf(kind, op.payload) ?? 'unknown'
    const remoteRevision =
      remote?.kind === 'tombstone'
        ? remote.tombstone.revision
        : remote?.kind === 'missing'
          ? remote.revision
          : (remote?.revision ?? null)
    if (remote?.kind === 'entry' || remote?.kind === 'preferences') {
      remoteRevisions.value[resource] = remote.revision
      delete remoteTombstones.value[resource]
    } else if (remote?.kind === 'tombstone') {
      remoteTombstones.value[resource] = remote.tombstone.revision
      delete remoteRevisions.value[resource]
    }
    const remoteCopy =
      remote?.kind === 'entry'
        ? remote.entry
        : remote?.kind === 'tombstone'
          ? remote.tombstone
          : remote?.kind === 'preferences'
            ? remote.value
            : null
    upsertConflict({
      resource,
      remoteKind:
        remote?.kind === 'entry'
          ? 'entry'
          : remote?.kind === 'preferences'
            ? 'preferences'
            : remote?.kind === 'tombstone'
              ? 'tombstone'
              : 'missing',
      local: op.payload,
      remote: remoteCopy,
      remoteRevision,
      label: conflictLabel(kind),
    })
  }

  // An explicit per-resource choice: replay local intent on top of the
  // remote revision, or accept the remote copy and drop queued intent.
  function resolveSyncConflict(resource: string, choice: 'keep-local' | 'keep-remote') {
    const conflict = syncConflicts.value.find((c) => c.resource === resource)
    if (!conflict) return
    const resourceOps = syncQueue.value.filter((o) => resourceOf(o.kind, o.payload) === resource)
    if (choice === 'keep-remote') {
      syncQueue.value = syncQueue.value.filter((o) => !resourceOps.includes(o))
      applyRemoteConflictState(conflict)
    } else {
      const staleIds = new Set(resourceOps.map((o) => o.operationId))
      syncQueue.value = syncQueue.value.filter((o) => !staleIds.has(o.operationId))
      if (resource.startsWith('entry:')) {
        const local = entries.value.find((e) => e.id === resource.slice('entry:'.length))
        if (local) enqueueSync(conflict.remoteKind === 'tombstone' ? 'entry-restore' : 'entry-upsert', local)
      } else if (resource === 'preferences') {
        lastPrefsFingerprint = ''
        enqueuePreferences()
      }
    }
    syncConflicts.value = syncConflicts.value.filter((c) => c.resource !== resource)
    scheduleFlush()
  }

  function applyRemoteConflictState(conflict: SyncConflictInfo) {
    if (conflict.resource.startsWith('entry:')) {
      const id = conflict.resource.slice('entry:'.length)
      if (conflict.remoteKind === 'entry' && conflict.remote && typeof conflict.remote === 'object') {
        const remoteEntry = conflict.remote as TimeEntry
        const idx = entries.value.findIndex((e) => e.id === id)
        if (idx === -1) entries.value.push({ ...remoteEntry })
        else entries.value[idx] = { ...remoteEntry }
        entries.value.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id))
      } else {
        entries.value = entries.value.filter((e) => e.id !== id)
      }
    } else if (conflict.resource === 'preferences' && conflict.remoteKind === 'preferences') {
      settings.value = { ...settings.value, ...(conflict.remote as Record<string, unknown>) }
      lastPrefsFingerprint = preferencesFingerprint(settings.value)
    }
  }

  // Rebind queued changes to the active endpoint. Only ever runs on an
  // explicit user action — endpoint provenance is never guessed.
  function adoptQueuedOpsToCurrentEndpoint(): number {
    const endpoint = currentEndpointId()
    if (endpoint === null) return 0
    let adopted = 0
    for (const op of syncQueue.value) {
      if (op.endpointId !== endpoint) {
        op.endpointId = endpoint
        if (op.status === 'blocked') {
          op.status = 'pending'
          op.blockedReason = null
        }
        adopted += 1
      }
    }
    if (adopted > 0) scheduleFlush()
    return adopted
  }

  async function flushSyncQueue() {
    if (syncBusy.value) return
    if (settings.value.backendMode !== 'sqlite') return
    const endpoint = currentEndpointId()
    if (endpoint === null) return
    syncBusy.value = true
    const exhaustedResources = new Set<string>()
    try {
      for (;;) {
        const op = syncQueue.value.find(
          (o) =>
            o.status === 'pending' &&
            o.endpointId === endpoint &&
            !exhaustedResources.has(resourceOf(o.kind, o.payload) ?? ''),
        )
        if (!op) break
        const resource = resourceOf(op.kind, op.payload)
        // 'entry-restore' only exists to undo a remote delete — when the
        // remote side has no tombstone it degrades to a plain upsert.
        const kind: SyncOpKind =
          op.kind === 'entry-restore' && !(resource !== null && resource in remoteTombstones.value)
            ? 'entry-upsert'
            : op.kind
        const baseRevision =
          resource === null
            ? null
            : (remoteTombstones.value[resource] ?? remoteRevisions.value[resource] ?? null)
        op.attempts += 1
        try {
          const ack = await api.postSyncOperation({
            operationId: op.operationId,
            kind,
            baseRevision,
            payload: op.payload,
          })
          applyAck(ack)
          syncQueue.value = syncQueue.value.filter((o) => o.operationId !== op.operationId)
        } catch (err) {
          if (err instanceof ApiError && err.status === 409) {
            recordOpConflict(op, err.body.remote as SyncRemoteState | undefined, kind)
            op.status = 'blocked'
            op.blockedReason = 'Conflicts with newer remote data — resolve it in Settings.'
            if (resource) exhaustedResources.add(resource)
            continue
          }
          if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
            op.status = 'blocked'
            op.blockedReason = 'The server rejected this change — it cannot be retried automatically.'
            if (resource) exhaustedResources.add(resource)
            continue
          }
          syncError.value = 'Sync failed — will retry automatically.'
          scheduleRetry()
          break
        }
      }
    } finally {
      syncBusy.value = false
    }
  }

  function onOnline() {
    void initFromBackend()
  }

  // Reactive clock ticked every second by the interval below. `Date.now()` is
  // NOT reactive, so computeds/templates that use it directly only evaluate
  // once and never count down. Reading `now.value` forces re-evaluation each
  // tick, matching the pattern used in WorkSessionTracker.vue.
  const now = ref(Date.now())
  function refreshNow() {
    now.value = Date.now()
    alertsPermission.value = readAlertPermission()
  }
  const clockInterval = setInterval(refreshNow, 1000)
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', refreshNow)
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('online', onOnline)
    window.addEventListener('pageshow', refreshNow)
  }

  onScopeDispose(() => {
    clearInterval(clockInterval)
    if (flushTimer) clearTimeout(flushTimer)
    if (retryTimer) clearTimeout(retryTimer)
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', refreshNow)
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('pageshow', refreshNow)
    }
  })

  // Progress check deadlines are device-local and never synchronize — only
  // the immutable outcome events travel (event-upsert in recordProgressEvent).

  // Run migration immediately when store is created to ensure new settings have defaults
  watch(settings, () => {
    migrateSettings()
  }, { immediate: true })

  // Active session and idle are derived from entries: an entry with end=null
  // is the currently running session (or idle). This makes them persistent
  // across page reloads since entries are persisted.
  const activeSession = computed<{
    type: TrackerType | null
    startTime: number | null
    description: string | null
    category: WorkCategory | null
  }>(() => {
    const entry = entries.value.find(e => e.end === null && e.type !== 'idle')
    if (entry) {
      return {
        type: entry.type,
        startTime: entry.start,
        description: entry.description ?? null,
        category: entry.category ?? null,
      }
    }
    return { type: null, startTime: null, description: null, category: null }
  })
  const idleStartTime = computed<number | null>(() => {
    const entry = entries.value.find(e => e.end === null && e.type === 'idle')
    return entry ? entry.start : null
  })
  const isRunning = computed(() => activeSession.value.type !== null)
  const currentSessionType = computed(() => activeSession.value.type)
  const currentSessionStartTime = computed(() => activeSession.value.startTime)

  // One running entry (activity or idle) is the normal invariant. Persisted
  // or synced data can still carry several open records, so extras surface as
  // a conflict requiring explicit reconciliation rather than silent cleanup.
  const openEntries = computed<TimeEntry[]>(() => entries.value.filter((e) => e.end === null))
  const openSessionConflict = computed(() => openEntries.value.length > 1)

  const STALE_SESSION_MS = 18 * 60 * 60 * 1000
  const forgottenEntry = computed<TimeEntry | null>(() =>
    openEntries.value.find((e) => e.type !== 'idle' && now.value - e.start > STALE_SESSION_MS) ?? null,
  )

  function closeEntryAt(id: string, end: number) {
    const idx = entries.value.findIndex((e) => e.id === id)
    if (idx === -1) return
    entries.value[idx] = { ...entries.value[idx]!, end }
    enqueueEntryUpsert(id)
  }

  function resolveOpenEntries(keepId: string | null): string | null {
    touchNow()
    const opens = openEntries.value
    if (opens.length <= 1) return null
    const keep = keepId === null ? null : opens.find((e) => e.id === keepId) ?? null
    if (keepId !== null && !keep) return 'Choose one of the running entries.'
    // A kept entry took over when it started, so extras close at its start
    // (clamped to their own start and to now); ending all uses the clock.
    const boundary = keep ? keep.start : now.value
    for (const e of opens) {
      if (keep && e.id === keep.id) continue
      closeEntryAt(e.id, Math.max(e.start, Math.min(boundary, now.value)))
    }
    reconcileProgress()
    return null
  }

  function startSession(type: TrackerType, description?: string, category?: WorkCategory) {
    const at = Date.now()
    now.value = at
    // Close every open entry (idle or active session) at the same timestamp,
    // so a switch is atomic and races cannot leave two running records.
    for (const open of openEntries.value) closeEntryAt(open.id, at)

    // Create a new open entry (end=null) for the new session
    const newEntry: TimeEntry = {
      id: generateId(),
      type,
      start: at,
      end: null,
      description: description || undefined,
      category: category || undefined,
    }
    entries.value.push(newEntry)
    enqueueSync('entry-upsert', newEntry)
  }

  function stopSession() {
    const openActive = openEntries.value.filter((e) => e.type !== 'idle')
    if (openActive.length === 0) return

    // Close every open activity entry at the same timestamp; an already-open
    // idle entry is left running instead of being duplicated below.
    const at = Date.now()
    now.value = at
    for (const entry of openActive) closeEntryAt(entry.id, at)
    initIdle()

    // Reset progress check when session ends
    reconcileProgress()
  }

  // Supportive break: switch to another activity through the same atomic
  // lifecycle as any session change, and remember what to offer back.
  const breakReturnType = ref<TrackerType | null>(null)

  function takeBreak(type: TrackerType = 'move') {
    const current = activeSession.value.type
    if (current !== null && current !== 'idle') breakReturnType.value = current
    startSession(type)
  }

  function resumeFromBreak() {
    const back = breakReturnType.value
    breakReturnType.value = null
    if (back !== null) startSession(back)
  }

  // If the backend wasn't up at startup, poll /api/health in the
  // background and run bootstrap once it answers — a reconnect merges
  // remote state into the running app rather than forcing a reload.
  async function watchForBackend() {
    if (backendWatchStarted || typeof window === 'undefined') return
    backendWatchStarted = true
    while (settings.value.backendMode === 'sqlite') {
      await new Promise((r) => setTimeout(r, 5000))
      if (await api.checkConnection()) {
        await initFromBackend()
        return
      }
    }
  }

  // Deterministic bootstrap: fetch the revisioned snapshot, overlay pending
  // local intent, surface divergences as conflicts, then drain the outbox.
  function applySyncSnapshot(snapshot: SyncSnapshot) {
    for (const { entry, revision } of snapshot.entries) {
      remoteRevisions.value[`entry:${entry.id}`] = revision
      delete remoteTombstones.value[`entry:${entry.id}`]
    }
    for (const t of snapshot.entryTombstones) {
      remoteTombstones.value[`entry:${t.id}`] = t.revision
      delete remoteRevisions.value[`entry:${t.id}`]
    }
    for (const { event, revision } of snapshot.progressEvents) {
      remoteRevisions.value[`event:${event.id}`] = revision
      delete remoteTombstones.value[`event:${event.id}`]
    }
    for (const t of snapshot.eventTombstones) {
      remoteTombstones.value[`event:${t.id}`] = t.revision
      delete remoteRevisions.value[`event:${t.id}`]
    }
    if (snapshot.preferences) remoteRevisions.value['preferences'] = snapshot.preferences.revision

    // Latest pending intent per entry decides how tombstones reconcile.
    const latestPendingKind = new Map<string, 'entry-upsert' | 'entry-delete' | 'entry-restore'>()
    for (const op of syncQueue.value) {
      if (op.status !== 'pending') continue
      const res = resourceOf(op.kind, op.payload)
      if (res && res.startsWith('entry:')) {
        latestPendingKind.set(res.slice('entry:'.length), op.kind as 'entry-upsert' | 'entry-delete' | 'entry-restore')
      }
    }

    const merged = mergeSnapshotEntries({
      localEntries: entries.value,
      remoteEntries: snapshot.entries,
      entryTombstones: snapshot.entryTombstones,
      latestPendingKind,
    })
    entries.value = merged.entries
    for (const c of merged.conflicts) {
      upsertConflict({
        resource: `entry:${c.entryId}`,
        remoteKind: c.remote === null ? 'tombstone' : 'entry',
        local: c.local,
        remote: c.remote,
        remoteRevision: c.remoteRevision,
        label: 'Entry',
      })
    }

    const endpoint = currentEndpointId()
    const hasPendingPrefs = syncQueue.value.some(
      (o) => o.kind === 'preferences-replace' && o.status === 'pending' && o.endpointId === endpoint,
    )
    if (snapshot.preferences && !hasPendingPrefs) {
      settings.value = { ...settings.value, ...snapshot.preferences.value }
      lastPrefsFingerprint = preferencesFingerprint(settings.value)
    } else if (snapshot.preferences === null && !hasPendingPrefs) {
      // The server has no preferences yet — publish the local set once.
      enqueuePreferences()
    }

    const localEventIds = new Set(progressEvents.value.map((e) => e.id))
    for (const { event } of snapshot.progressEvents) {
      if (!localEventIds.has(event.id)) progressEvents.value.push({ ...event })
    }
    progressEvents.value.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))

    // Seed local-only resources that never made it into the outbox (e.g.
    // first connect of a device with pre-existing local data).
    const remoteEntryIds = new Set(snapshot.entries.map(({ entry }) => entry.id))
    const tombstonedEntryIds = new Set(snapshot.entryTombstones.map((t) => t.id))
    const remoteEventIds = new Set(snapshot.progressEvents.map(({ event }) => event.id))
    const tombstonedEventIds = new Set(snapshot.eventTombstones.map((t) => t.id))
    const pendingEventIds = new Set(
      syncQueue.value
        .filter((o) => o.status === 'pending' && (o.kind === 'event-upsert' || o.kind === 'event-delete'))
        .map((o) => (resourceOf(o.kind, o.payload) ?? '').slice('event:'.length)),
    )
    for (const entry of entries.value) {
      if (remoteEntryIds.has(entry.id) || tombstonedEntryIds.has(entry.id)) continue
      if (latestPendingKind.has(entry.id)) continue
      enqueueSync('entry-upsert', entry)
    }
    for (const event of progressEvents.value) {
      if (remoteEventIds.has(event.id) || tombstonedEventIds.has(event.id)) continue
      if (pendingEventIds.has(event.id)) continue
      enqueueSync('event-upsert', event)
    }
  }

  async function initFromBackend() {
    if (settings.value.backendMode !== 'sqlite') return
    if (bootstrapping) return
    api.setBaseUrl(settings.value.backendUrl)
    api.setBackendMode(settings.value.backendMode)
    bootstrapping = true
    try {
      const reachable = await api.checkConnection()
      if (!reachable) {
        void watchForBackend()
        return
      }
      const snapshot = await api.getSyncSnapshot()
      applySyncSnapshot(snapshot)
      await flushSyncQueue()
    } catch (err) {
      console.warn('[megagrind] Sync bootstrap failed, keeping local data', err)
      syncError.value = 'Could not reach the sync server.'
      void watchForBackend()
    } finally {
      bootstrapping = false
    }
  }

  function retrySync() {
    syncError.value = null
    retryDelayMs = 1000
    void initFromBackend()
  }

  function addManualEntry(entry: Omit<TimeEntry, 'id'>) {
    const fullEntry: TimeEntry = {
      ...entry,
      id: generateId(),
    }

    // All manual entries are corrections (adjustments to tracked time)
    const isNegativeCorrection = entry.end !== null && entry.end < entry.start
    fullEntry.isCorrection = true

    if (entry.end !== null) {
      // Check for opposite correction within 3 minutes to balance
      const threeMinutesAgo = Date.now() - 3 * 60 * 1000
      const correctionValue = Math.abs(entry.end - entry.start)
      const recentCorrections = entries.value.filter(e =>
        e.isCorrection &&
        e.end !== null &&
        !e.balancedWith &&
        e.start >= threeMinutesAgo &&
        Math.abs(e.end - e.start) === correctionValue
      )

      if (recentCorrections.length > 0) {
        // Check if there's an opposite correction to balance
        const lastCorrection = recentCorrections[recentCorrections.length - 1]
        if (lastCorrection && lastCorrection.end !== null) {
          const lastIsNegative = lastCorrection.end < lastCorrection.start

          // If this is opposite sign, they balance each other
          if (lastIsNegative !== isNegativeCorrection) {
            // Link them together
            fullEntry.balancedWith = lastCorrection.id
            const lastCorrectionIndex = entries.value.findIndex(e => e.id === lastCorrection.id)
            if (lastCorrectionIndex !== -1 && entries.value[lastCorrectionIndex]) {
              entries.value[lastCorrectionIndex].balancedWith = fullEntry.id
              enqueueEntryUpsert(lastCorrection.id)
            }
          }
        }
      }
    }

    entries.value.push(fullEntry)
    enqueueSync('entry-upsert', fullEntry)
  }

  function deleteEntry(id: string) {
    const index = entries.value.findIndex((e) => e.id === id)
    if (index !== -1) {
      entries.value.splice(index, 1)
      enqueueSync('entry-delete', { id })
    }
  }

  function updateEntry(id: string, updates: Partial<Omit<TimeEntry, 'id'>>) {
    const index = entries.value.findIndex((e) => e.id === id)
    if (index !== -1) {
      entries.value[index] = { ...entries.value[index], ...updates } as TimeEntry
      enqueueEntryUpsert(id)
    }
  }

  function restoreEntry(entry: TimeEntry): string | null {
    if (entry.end === null && entries.value.some((e) => e.end === null && e.id !== entry.id)) {
      return 'Another activity is running. Stop it before restoring this entry.'
    }
    const copy = { ...entry }
    const index = entries.value.findIndex((e) => e.id === entry.id)
    if (index === -1) {
      entries.value.push(copy)
    } else {
      entries.value[index] = copy
    }
    // Restore after a delete may need to undo a remote tombstone — the
    // restore kind is resolved against the tombstone map at flush time.
    enqueueSync('entry-restore', copy)
    return null
  }

  function getEntriesByType(type: TrackerType): TimeEntry[] {
    return entries.value.filter((e) => e.type === type)
  }

  function getEntriesByTypeAndDay(type: TrackerType, dayStart: number, dayEnd: number): TimeEntry[] {
    return sliceEntries(
      entries.value.filter((e) => e.type === type && e.end !== null),
      { start: dayStart, end: dayEnd },
      now.value,
    ).map((slice) => slice.isAdjustment
      ? { ...slice.entry }
      : { ...slice.entry, start: slice.start, end: slice.end })
  }

  function getEntrySlices(range: TimeRange, includeRunning = true): EntrySlice[] {
    return sliceEntries(entries.value, range, now.value).filter((slice) => includeRunning || !slice.isRunning)
  }

  function getTotalTimeForRange(range: TimeRange, type?: TrackerType): number {
    return totalDuration(entries.value, range, now.value, type)
  }

  function getCoveredTimeForRange(range: TimeRange): number {
    return coveredDuration(getEntrySlices(range))
  }

  function getTotalTimeForType(type: TrackerType): number {
    return totalDuration(entries.value, currentWeekRange.value, now.value, type)
  }

  function getTotalTimeForTypeAndDay(type: TrackerType, dayStart: number, dayEnd: number): number {
    return totalDuration(entries.value, { start: dayStart, end: dayEnd }, now.value, type)
  }

  function getCurrentSessionDuration(): number {
    const entry = entries.value.find(e => e.end === null && e.type !== 'idle')
    if (!entry) return 0
    return Math.max(0, now.value - entry.start)
  }

  function getCurrentIdleDuration(): number {
    const entry = entries.value.find(e => e.end === null && e.type === 'idle')
    if (!entry) return 0
    return Math.max(0, now.value - entry.start)
  }

  function initIdle() {
    // Opt-in idle tracking starts only when nothing at all is open — never
    // over a restored running session or an existing idle entry.
    if (!settings.value.idleTimeEnabled || openEntries.value.length > 0) return
    const at = Date.now()
    now.value = at
    const idleEntry: TimeEntry = {
      id: generateId(),
      type: 'idle',
      start: at,
      end: null,
    }
    entries.value.push(idleEntry)
    enqueueSync('entry-upsert', idleEntry)
  }

  // Keep the idle lifecycle consistent with the preference: disabling it
  // closes any open idle entry, enabling it applies the same invariant as
  // initial load.
  watch(() => settings.value.idleTimeEnabled, (enabled) => {
    if (enabled) {
      initIdle()
      return
    }
    const open = entries.value.find((e) => e.end === null && e.type === 'idle')
    if (open) closeEntryAt(open.id, Date.now())
  })

  // Whether a work session is currently active and the timer should be running.
  const currentWorkSessionId = computed<string | null>(() =>
    entries.value.find(e => e.end === null && e.type === 'work')?.id ?? null,
  )

  function touchNow() {
    now.value = Date.now()
  }

  function progressContext(): ProgressContext {
    return {
      now: now.value,
      workId: currentWorkSessionId.value,
      enabled: settings.value.progressCheckEnabled,
      intervalMs: (settings.value.progressCheckInterval ?? 15) * 60 * 1000,
    }
  }

  function commitProgress(next: ProgressState) {
    const changed = Object.fromEntries(
      Object.entries(next).filter(([key, value]) => progressCheck.value[key as keyof ProgressState] !== value),
    )
    if (Object.keys(changed).length > 0) Object.assign(progressCheck.value, changed)
  }

  function recordProgressEvent(sessionId: string, outcome: ProgressEvent['outcome']) {
    const event: ProgressEvent = { id: generateId(), sessionId, at: now.value, outcome }
    progressEvents.value.push(event)
    if (progressHistoryStartedAt.value === null) progressHistoryStartedAt.value = now.value
    enqueueSync('event-upsert', event)
  }

  let reconcilingProgress = false
  function reconcileProgress() {
    if (reconcilingProgress) return
    reconcilingProgress = true
    try {
      const result = reconcileProgressState(progressCheck.value, progressContext())
      commitProgress(result.state)
      for (const sessionId of result.skipped) recordProgressEvent(sessionId, 'skipped')
    } finally {
      reconcilingProgress = false
    }
  }

  function resetStaleProgressCheck() {
    touchNow()
    reconcileProgress()
  }

  function recordProgressCheck(madeProgress: boolean) {
    touchNow()
    const ctx = progressContext()
    if (ctx.workId !== null) recordProgressEvent(ctx.workId, madeProgress ? 'progress' : 'blocked')
    commitProgress(answerProgressState(progressCheck.value, ctx, madeProgress))
  }

  function resetRedCount() {
    progressCheck.value.redCount = 0
  }

  function resetProgressCheck() {
    commitProgress({ ...PROGRESS_DEFAULTS })
    progressEvents.value = []
    progressHistoryStartedAt.value = null
  }

  function readAlertPermission(): NotificationPermission | 'unsupported' {
    return 'Notification' in globalThis ? Notification.permission : 'unsupported'
  }

  const alertsPermission = ref<NotificationPermission | 'unsupported'>(readAlertPermission())
  const alertRequestPending = ref(false)
  const alertError = ref<string | null>(null)

  function reportAlertFailure(message: string) {
    alertError.value = message
  }

  async function requestBrowserAlerts() {
    if (alertRequestPending.value || alertsPermission.value !== 'default') return
    alertRequestPending.value = true
    alertError.value = null
    try {
      alertsPermission.value = await Notification.requestPermission()
      if (alertsPermission.value === 'granted') updateSettings({ notificationsEnabled: true })
    } catch {
      reportAlertFailure('Browser alerts could not be enabled. Check this site\'s notification permission and try again.')
    } finally {
      alertRequestPending.value = false
    }
  }

  function snoozeProgressCheck() {
    touchNow()
    const ctx = progressContext()
    if (ctx.workId !== null) recordProgressEvent(ctx.workId, 'snoozed')
    commitProgress(snoozeProgressState(progressCheck.value, ctx))
  }

  function enableFocusMode() {
    touchNow()
    commitProgress(enableFocusState(progressCheck.value, progressContext(), settings.value.focusModeDuration * 60 * 1000))
  }

  function disableFocusMode() {
    touchNow()
    commitProgress(disableFocusState(progressCheck.value, progressContext()))
  }

  function applyProgressIntervalChange() {
    touchNow()
    commitProgress(applyIntervalState(progressCheck.value, progressContext()))
  }

  const isProgressPromptDue = computed(() =>
    progressCheck.value.pendingSessionId !== null && progressCheck.value.pendingSessionId === currentWorkSessionId.value,
  )

  const progressTimeRemaining = computed<number | null>(() => {
    const pc = progressCheck.value
    if (pc.nextCheckAt !== null) return Math.max(0, pc.nextCheckAt - now.value)
    if (pc.pausedReason !== null && pc.remainingMs !== null) return pc.remainingMs
    return null
  })

  const todayBlockedCount = computed(() => {
    const day = dayRange(now.value)
    return progressEvents.value.filter(e => e.outcome === 'blocked' && e.at >= day.start && e.at < day.end).length
  })

  function migrateSettings() {
    if (!settings.value.choreCategories) {
      settings.value.choreCategories = [...DEFAULT_CHORE_CATEGORIES]
    }
    if (!settings.value.workCategories) {
      settings.value.workCategories = [...DEFAULT_WORK_CATEGORIES]
    }
    if (!settings.value.customChronos) {
      settings.value.customChronos = []
    }
    if (settings.value.progressCheckInterval === undefined) {
      settings.value.progressCheckInterval = DEFAULT_SETTINGS.progressCheckInterval
    }
    if (settings.value.focusModeDuration === undefined) {
      settings.value.focusModeDuration = DEFAULT_SETTINGS.focusModeDuration
    }
    if (settings.value.backendMode === undefined) {
      settings.value.backendMode = DEFAULT_SETTINGS.backendMode
    }
    if (settings.value.backendUrl === undefined) {
      settings.value.backendUrl = DEFAULT_SETTINGS.backendUrl
    }
    if (settings.value.darkMode === undefined) {
      settings.value.darkMode = DEFAULT_SETTINGS.darkMode
    }
    if (settings.value.notificationsEnabled === undefined) {
      settings.value.notificationsEnabled = DEFAULT_SETTINGS.notificationsEnabled
    }
    if (settings.value.soundEnabled === undefined) {
      settings.value.soundEnabled = DEFAULT_SETTINGS.soundEnabled
    }
    if (settings.value.idleTimeEnabled === undefined) {
      settings.value.idleTimeEnabled = DEFAULT_SETTINGS.idleTimeEnabled
    }
    if (settings.value.progressCheckEnabled === undefined) {
      settings.value.progressCheckEnabled = DEFAULT_SETTINGS.progressCheckEnabled
    }
    if (settings.value.weekRolloverDay === undefined) {
      settings.value.weekRolloverDay = DEFAULT_SETTINGS.weekRolloverDay
    }
    if (settings.value.weekRolloverHour === undefined) {
      settings.value.weekRolloverHour = DEFAULT_SETTINGS.weekRolloverHour
    }
    if (!settings.value.weeklyAllocations) {
      settings.value.weeklyAllocations = { ...DEFAULT_SETTINGS.weeklyAllocations }
    }
    if (!('chores' in settings.value.weeklyAllocations)) {
      settings.value.weeklyAllocations = normalizeLegacyAllocations(settings.value.weeklyAllocations)
    }
    // Additive preference fields (M1.2/M5.1): established stores get their
    // coverage reconciled at decode time; these are the runtime safety net.
    if (!Array.isArray(settings.value.activities)) {
      settings.value.activities = buildDefaultActivities()
    }
    if (!settings.value.goals || typeof settings.value.goals !== 'object') {
      settings.value.goals = {}
    }
    if (settings.value.onboardingCompleted === undefined) {
      settings.value.onboardingCompleted = true
    }
  }

  // First-use setup is skippable and device-local: finishing or skipping marks
  // it complete, and every chosen value lands in ordinary settings edits.
  function completeOnboarding(patch?: {
    favorites?: TrackerType[]
    goals?: Record<string, Goal>
    weekRolloverDay?: number
    weekRolloverHour?: number
    darkMode?: Settings['darkMode']
  }) {
    if (patch?.weekRolloverDay !== undefined) settings.value.weekRolloverDay = patch.weekRolloverDay
    if (patch?.weekRolloverHour !== undefined) settings.value.weekRolloverHour = patch.weekRolloverHour
    if (patch?.darkMode !== undefined) settings.value.darkMode = patch.darkMode
    if (patch?.favorites) {
      const wanted = new Set(patch.favorites)
      const defs = activityDefinitions(
        settings.value.customChronos,
        entries.value.map((e) => e.type),
        settings.value.activities,
      )
      settings.value.activities = defs.map((d, i) => ({ ...d, favorite: wanted.has(d.id), order: i }))
    }
    if (patch?.goals) settings.value.goals = { ...patch.goals }
    settings.value.onboardingCompleted = true
  }

  function updateSettings(newSettings: Partial<Settings>) {
    settings.value = { ...settings.value, ...newSettings }
    enqueuePreferences()
  }

  function exportWeekData(): WeekData {
    return {
      version: 1,
      weekStart: getWeekStart(),
      entries: entries.value,
      settings: settings.value,
    }
  }

  function exportFullBackup(): FullBackupV2 {
    return makeFullBackup({
      exportedAt: Date.now(),
      entries: entries.value,
      settings: settings.value,
      progressEvents: progressEvents.value,
      progressHistoryStartedAt: progressHistoryStartedAt.value,
    })
  }

  function exportPeriodReport(range: TimeRange) {
    return makePeriodReport({ exportedAt: Date.now(), range, now: now.value, entries: entries.value })
  }

  function parseBackupText(text: string): FullBackupV2 {
    const decoded = decodeImportDocument(text)
    if (decoded.kind !== 'full') throw new Error('This file is a read-only period report, not a restorable backup')
    return decoded.backup
  }

  function previewBackupImport(backup: FullBackupV2, mode: 'merge' | 'replace'): ImportPreview {
    return previewImport({ imported: backup, localEntries: entries.value, localEvents: progressEvents.value, mode, now: now.value })
  }

  function applyBackupImport(backup: FullBackupV2, options: ImportApplyOptions): ImportApplyResult {
    const restored = {
      ...options,
      eventMode: options.eventMode ?? options.mode,
    }
    const localEntriesBefore = entries.value
    const localEventsBefore = progressEvents.value
    const result = applyImport({
      imported: backup,
      localEntries: entries.value,
      localSettings: settings.value,
      localEvents: progressEvents.value,
      localHistoryStartedAt: progressHistoryStartedAt.value,
      options: restored,
      now: now.value,
    })
    if (result.kind !== 'ok') return result
    if (options.mode === 'replace') {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw || writeRecoverySnapshot(localStorage, raw) === null) {
        return { kind: 'blocked', reason: 'A verified same-browser recovery copy could not be saved before replacing local records.', needs: 'snapshot' }
      }
    }
    entries.value = result.entries
    progressEvents.value = result.progressEvents
    progressHistoryStartedAt.value = result.progressHistoryStartedAt
    if (result.settingsPatch) {
      settings.value = { ...settings.value, ...result.settingsPatch }
    }
    if (settings.value.backendMode === 'sqlite') {
      if (options.mode === 'merge') {
        const importedById = new Map(backup.entries.map((entry) => [entry.id, entry]))
        for (const id of result.changedIds) {
          const entry = importedById.get(id) ?? entries.value.find((candidate) => candidate.id === id)
          if (entry) enqueueSync('entry-upsert', entry)
        }
        if (result.settingsPatch) enqueuePreferences()
      } else {
        // Remote replace: the restored set supersedes every queued intent for
        // the covered resources — drop pending/blocked ops and conflicts,
        // tombstone locally removed ids remotely, then upsert the survivors.
        const keptEntryIds = new Set(result.entries.map((e) => e.id))
        const keptEventIds = new Set(result.progressEvents.map((e) => e.id))
        const removedEntryIds = localEntriesBefore.filter((e) => !keptEntryIds.has(e.id)).map((e) => e.id)
        const removedEventIds = localEventsBefore.filter((e) => !keptEventIds.has(e.id)).map((e) => e.id)
        const superseded = (resource: string | null) =>
          resource === 'preferences' || resource?.startsWith('entry:') === true || resource?.startsWith('event:') === true
        syncQueue.value = syncQueue.value.filter((op) => !superseded(resourceOf(op.kind, op.payload)))
        syncConflicts.value = syncConflicts.value.filter((c) => !superseded(c.resource))
        for (const id of removedEntryIds) enqueueSync('entry-delete', { id })
        for (const entry of result.entries) enqueueSync('entry-upsert', entry)
        for (const id of removedEventIds) enqueueSync('event-delete', { id })
        for (const event of result.progressEvents) enqueueSync('event-upsert', event)
        if (result.settingsPatch) enqueuePreferences()
      }
    }
    return result
  }

  function importWeekData(data: WeekData) {
    const backup = parseBackupText(JSON.stringify({
      version: 1,
      weekStart: data.weekStart,
      entries: data.entries,
      settings: data.settings,
      progressEvents: [],
      progressHistoryStartedAt: null,
      exportedAt: Date.now(),
    }))
    const conflictChoices = Object.fromEntries(
      entries.value
        .filter((local) => backup.entries.some((incoming) => incoming.id === local.id))
        .map((local) => [local.id, 'imported' as const]),
    )
    const result = applyBackupImport(backup, { mode: 'merge', conflictChoices, restorePreferences: true, eventMode: 'merge' })
    if (result.kind === 'blocked') throw new Error(result.reason)
  }

  function clearLocalHistory() {
    entries.value = []
    progressEvents.value = []
    progressHistoryStartedAt.value = null
    resetProgressCheck()
  }

  // Single source of truth for the current week boundary. Recomputes when
  // rollover settings change; entries before this are excluded from totals.
  // On the rollover day before the rollover hour the computed start is
  // in the future — the current week actually began 7 days earlier.
  const currentWeekRange = computed<TimeRange>(() =>
    weekRange(now.value, settings.value.weekRolloverDay, settings.value.weekRolloverHour),
  )
  const currentWeekStart = computed(() => currentWeekRange.value.start)

  function getWeekStart(): number {
    return currentWeekRange.value.start
  }

  function getDayStart(date: Date = new Date(now.value)): number {
    return dayRange(date.getTime()).start
  }

  function getDayEnd(date: Date = new Date(now.value)): number {
    return dayRange(date.getTime()).end
  }

  return {
    now: computed(() => now.value),
    entries,
    settings,
    activeSession,
    progressCheck,
    idleStartTime,
    isRunning,
    currentSessionType,
    currentSessionStartTime,
    openEntries,
    openSessionConflict,
    forgottenEntry,
    STALE_SESSION_MS,
    resolveOpenEntries,
    startSession,
    stopSession,
    takeBreak,
    resumeFromBreak,
    breakReturnType,
    addManualEntry,
    deleteEntry,
    updateEntry,
    getEntriesByType,
    getEntriesByTypeAndDay,
    getEntrySlices,
    getTotalTimeForRange,
    getCoveredTimeForRange,
    getTotalTimeForType,
    getTotalTimeForTypeAndDay,
    getCurrentSessionDuration,
    getCurrentIdleDuration,
    initIdle,
    resetStaleProgressCheck,
    recordProgressCheck,
    resetRedCount,
    resetProgressCheck,
    snoozeProgressCheck,
    enableFocusMode,
    disableFocusMode,
    migrateSettings,
    completeOnboarding,
    updateSettings,
    exportWeekData,
    exportFullBackup,
    exportPeriodReport,
    parseBackupText,
    previewBackupImport,
    applyBackupImport,
    clearLocalHistory,
    importWeekData,
    getWeekStart,
    getDayStart,
    getDayEnd,
    initFromBackend,
    retrySync,
    syncQueue,
    pendingSyncCount,
    blockedSyncCount,
    foreignSyncCount,
    syncStatus,
    syncConflicts,
    syncError,
    syncBusy,
    lastSyncedAt,
    remoteRevisions,
    remoteTombstones,
    resolveSyncConflict,
    adoptQueuedOpsToCurrentEndpoint,
    flushSyncQueue,
    currentWeekStart,
    currentWeekRange,
    progressEvents,
    progressHistoryStartedAt,
    currentWorkSessionId,
    isProgressPromptDue,
    progressTimeRemaining,
    todayBlockedCount,
    reconcileProgress,
    applyProgressIntervalChange,
    alertsPermission,
    alertRequestPending,
    alertError,
    reportAlertFailure,
    requestBrowserAlerts,
    restoreEntry,
    persistenceState,
    persistenceError,
    lastSavedPayload,
    markPersistenceResult,
    saveSucceeded,
    retryPersistence,
  }
})
