import { defineStore } from 'pinia'
import { ref, computed, watch, onScopeDispose } from 'vue'
import type { TimeEntry, TimeRange, EntrySlice, TrackerType, WorkCategory, Settings, WeekData, SyncOp, ProgressEvent } from '../types'
import { applyImport, decodeImportDocument, makeFullBackup, makePeriodReport, previewImport, STORAGE_KEY, writeRecoverySnapshot, type FullBackupV2, type ImportApplyOptions, type ImportApplyResult, type ImportPreview, type PersistenceState } from '../domain/backup'
import { DEFAULT_SETTINGS, DEFAULT_CHORE_CATEGORIES, DEFAULT_WORK_CATEGORIES, createDefaultSettings } from '../types'
import { useApi } from '../composables/useApi'
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
  // Sync outbox: every mutation enqueues an op; ops flush FIFO to the
  // backend and persist across reloads so a failed write is never lost.
  // ------------------------------------------------------------------
  const syncQueue = ref<SyncOp[]>([])
  const pendingSyncCount = computed(() => syncQueue.value.length)
  let flushing = false
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let pcSyncTimer: ReturnType<typeof setTimeout> | null = null
  let backendWatchStarted = false

  function enqueueSync(op: SyncOp) {
    if (settings.value.backendMode !== 'sqlite') return
    // Coalesce: keep only the latest op per target.
    if (op.kind === 'upsert-entry') {
      syncQueue.value = syncQueue.value.filter(
        (o) => !(o.kind === 'upsert-entry' && o.entry.id === op.entry.id),
      )
    } else if (op.kind === 'delete-entry') {
      syncQueue.value = syncQueue.value.filter(
        (o) => !(o.kind === 'upsert-entry' && o.entry.id === op.id)
          && !(o.kind === 'delete-entry' && o.id === op.id),
      )
    } else if (op.kind === 'settings') {
      syncQueue.value = syncQueue.value.filter((o) => o.kind !== 'settings')
    } else if (op.kind === 'state') {
      syncQueue.value = syncQueue.value.filter(
        (o) => !(o.kind === 'state' && o.key === op.key),
      )
    }
    syncQueue.value.push(op)
    scheduleFlush()
  }

  function enqueueEntryUpsert(id: string) {
    const entry = entries.value.find((e) => e.id === id)
    if (entry) enqueueSync({ kind: 'upsert-entry', entry: { ...entry } })
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
    retryTimer = setTimeout(() => {
      retryTimer = null
      void flushSyncQueue()
    }, 1000)
  }

  async function applySyncOp(op: SyncOp) {
    switch (op.kind) {
      case 'upsert-entry':
        await api.bulkUpsertEntries([op.entry])
        break
      case 'bulk-entries':
        await api.bulkUpsertEntries(op.entries)
        break
      case 'delete-entry':
        await api.deleteEntry(op.id)
        break
      case 'settings':
        await api.updateSettings(op.settings)
        break
      case 'state':
        await api.putState(op.key, op.value)
        break
    }
  }

  async function flushSyncQueue() {
    if (flushing) return
    if (settings.value.backendMode !== 'sqlite') return
    flushing = true
    try {
      while (syncQueue.value.length > 0) {
        const op = syncQueue.value[0]!
        try {
          await applySyncOp(op)
          syncQueue.value.shift()
        } catch (err) {
          console.warn('[megagrind] Sync op failed, will retry', err)
          scheduleRetry()
          break
        }
      }
    } finally {
      flushing = false
    }
  }

  function onOnline() {
    void flushSyncQueue()
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
    if (pcSyncTimer) clearTimeout(pcSyncTimer)
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', refreshNow)
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('pageshow', refreshNow)
    }
  })

  // Debounced progressCheck sync — mutations are frequent, state is small.
  watch(progressCheck, () => {
    if (settings.value.backendMode !== 'sqlite') return
    if (pcSyncTimer) clearTimeout(pcSyncTimer)
    pcSyncTimer = setTimeout(() => {
      enqueueSync({ kind: 'state', key: 'progressCheck', value: { ...progressCheck.value } })
    }, 2000)
  }, { deep: true })

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

  function startSession(type: TrackerType, description?: string, category?: WorkCategory) {
    const at = Date.now()
    now.value = at
    // Close any open entry (idle or active session) by setting its end time
    const openEntry = entries.value.find(e => e.end === null)
    if (openEntry) {
      const idx = entries.value.indexOf(openEntry)
      entries.value[idx] = { ...openEntry, end: at }
      enqueueEntryUpsert(openEntry.id)
    }

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
    enqueueSync({ kind: 'upsert-entry', entry: { ...newEntry } })
  }

  function stopSession() {
    const openEntry = entries.value.find(e => e.end === null && e.type !== 'idle')
    if (!openEntry) return

    // Close the active session entry by setting its end time
    const at = Date.now()
    now.value = at
    const idx = entries.value.indexOf(openEntry)
    entries.value[idx] = { ...openEntry, end: at }
    enqueueEntryUpsert(openEntry.id)

    // Start tracking idle time with a new open idle entry (if enabled)
    if (settings.value.idleTimeEnabled) {
      const idleEntry: TimeEntry = {
        id: generateId(),
        type: 'idle',
        start: at,
        end: null,
      }
      entries.value.push(idleEntry)
      enqueueSync({ kind: 'upsert-entry', entry: { ...idleEntry } })
    }

    // Reset progress check when session ends
    reconcileProgress()
  }

  // If the backend wasn't up at startup, poll /api/health in the
  // background and reload once it answers so remote data is pulled in.
  async function watchForBackend() {
    if (backendWatchStarted || typeof window === 'undefined') return
    backendWatchStarted = true
    while (settings.value.backendMode === 'sqlite') {
      await new Promise((r) => setTimeout(r, 5000))
      if (await api.checkConnection()) {
        window.location.reload()
        return
      }
    }
  }

  async function initFromBackend() {
    if (settings.value.backendMode !== 'sqlite') return
    api.setBaseUrl(settings.value.backendUrl)
    api.setBackendMode(settings.value.backendMode)
    try {
      const reachable = await api.checkConnection()
      if (!reachable) {
        void watchForBackend()
        return
      }

      // Push local-only entries first so nothing is lost, then merge
      // with server winning on conflicts.
      const remoteEntries = await api.getEntries()
      const remoteIds = new Set(remoteEntries.map((e) => e.id))
      const localOnly = entries.value.filter((e) => !remoteIds.has(e.id))
      if (localOnly.length > 0) {
        await api.bulkUpsertEntries(localOnly)
      }
      const merged = new Map<string, TimeEntry>()
      for (const e of entries.value) merged.set(e.id, e)
      for (const e of remoteEntries) merged.set(e.id, e)
      entries.value = [...merged.values()].sort((a, b) => a.start - b.start)

      const remoteSettings = await api.getSettings()
      if (remoteSettings) {
        const { backendMode: _backendMode, backendUrl: _backendUrl, ...rest } = remoteSettings
        settings.value = { ...settings.value, ...rest }
      } else {
        await api.updateSettings(settings.value)
      }

      const remotePc = await api.getState<typeof progressCheck.value>('progressCheck')
      if (remotePc && typeof remotePc === 'object') {
        progressCheck.value = { ...progressCheck.value, ...remotePc }
      }

      await flushSyncQueue()
    } catch (err) {
      console.warn('[megagrind] Failed to load from backend, using local data', err)
    }
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
    enqueueSync({ kind: 'upsert-entry', entry: { ...fullEntry } })
  }

  function deleteEntry(id: string) {
    const index = entries.value.findIndex((e) => e.id === id)
    if (index !== -1) {
      entries.value.splice(index, 1)
      enqueueSync({ kind: 'delete-entry', id })
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
    enqueueEntryUpsert(entry.id)
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
    // If nothing is running and there's no open idle entry, create one (if enabled)
    if (settings.value.idleTimeEnabled && !isRunning.value && idleStartTime.value === null) {
      const idleEntry: TimeEntry = {
        id: generateId(),
        type: 'idle',
        start: Date.now(),
        end: null,
      }
      entries.value.push(idleEntry)
      enqueueSync({ kind: 'upsert-entry', entry: { ...idleEntry } })
    }
  }

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
    progressEvents.value.push({ id: generateId(), sessionId, at: now.value, outcome })
    if (progressHistoryStartedAt.value === null) progressHistoryStartedAt.value = now.value
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
  }

  function updateSettings(newSettings: Partial<Settings>) {
    settings.value = { ...settings.value, ...newSettings }
    enqueueSync({ kind: 'settings', settings: { ...settings.value } })
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
    const result = applyImport({
      imported: backup,
      localEntries: entries.value,
      localSettings: settings.value,
      localEvents: progressEvents.value,
      localHistoryStartedAt: progressHistoryStartedAt.value,
      options,
      now: now.value,
    })
    if (result.kind !== 'ok') return result
    if (options.mode === 'replace') {
      if (settings.value.backendMode === 'sqlite') {
        throw new Error('Remote replace is disabled in sync mode. The remote restore protocol is still pending.')
      }
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
    if (settings.value.backendMode === 'sqlite' && options.mode === 'merge') {
      const importedById = new Map(backup.entries.map((entry) => [entry.id, entry]))
      for (const id of result.changedIds) {
        const entry = importedById.get(id) ?? entries.value.find((candidate) => candidate.id === id)
        if (entry) enqueueSync({ kind: 'upsert-entry', entry: { ...entry } })
      }
      if (result.settingsPatch) enqueueSync({ kind: 'settings', settings: { ...settings.value } })
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
    startSession,
    stopSession,
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
    syncQueue,
    pendingSyncCount,
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
