import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import type { TimeEntry, TrackerType, WorkCategory, Settings, WeekData, SyncOp } from '../types'
import { DEFAULT_SETTINGS, DEFAULT_CHORE_CATEGORIES, DEFAULT_WORK_CATEGORIES } from '../types'
import { useApi } from '../composables/useApi'

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`
}

export const useMegagrindStore = defineStore('megagrind', () => {
  const entries = ref<TimeEntry[]>([])
  const settings = ref<Settings>({ ...DEFAULT_SETTINGS })
  const progressCheck = ref({
    lastCheck: null as number | null,
    redCount: 0,
    snoozeUntil: null as number | null,
    focusModeUntil: null as number | null,
    nextCheckAt: null as number | null,
  })
  const api = useApi()

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
    if (settings.value.backendMode === 'local') return
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
    if (settings.value.backendMode === 'local') return
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
    if (settings.value.backendMode === 'local') return
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

  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => void flushSyncQueue())
  }

  // Debounced progressCheck sync — mutations are frequent, state is small.
  watch(progressCheck, () => {
    if (settings.value.backendMode === 'local') return
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
    // Close any open entry (idle or active session) by setting its end time
    const openEntry = entries.value.find(e => e.end === null)
    if (openEntry) {
      const idx = entries.value.indexOf(openEntry)
      const now = Date.now()
      entries.value[idx] = { ...openEntry, end: now }
      enqueueEntryUpsert(openEntry.id)
    }

    // Create a new open entry (end=null) for the new session
    const newEntry: TimeEntry = {
      id: generateId(),
      type,
      start: Date.now(),
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
    const idx = entries.value.indexOf(openEntry)
    const now = Date.now()
    entries.value[idx] = { ...openEntry, end: now }
    enqueueEntryUpsert(openEntry.id)

    // Start tracking idle time with a new open idle entry (if enabled)
    if (settings.value.idleTimeEnabled) {
      const idleEntry: TimeEntry = {
        id: generateId(),
        type: 'idle',
        start: Date.now(),
        end: null,
      }
      entries.value.push(idleEntry)
      enqueueSync({ kind: 'upsert-entry', entry: { ...idleEntry } })
    }

    // Reset progress check when session ends
    progressCheck.value.redCount = 0
    progressCheck.value.lastCheck = null
    progressCheck.value.snoozeUntil = null
    progressCheck.value.focusModeUntil = null
    progressCheck.value.nextCheckAt = null
  }

  // If the backend wasn't up at startup, poll /api/health in the
  // background and reload once it answers so remote data is pulled in.
  async function watchForBackend() {
    if (backendWatchStarted || typeof window === 'undefined') return
    backendWatchStarted = true
    while (settings.value.backendMode !== 'local') {
      await new Promise((r) => setTimeout(r, 5000))
      if (await api.checkConnection()) {
        window.location.reload()
        return
      }
    }
  }

  async function initFromBackend() {
    if (settings.value.backendMode === 'local') return
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

  function getEntriesByType(type: TrackerType): TimeEntry[] {
    return entries.value.filter((e) => e.type === type)
  }

  function getEntriesByTypeAndDay(type: TrackerType, dayStart: number, dayEnd: number): TimeEntry[] {
    return entries.value.filter(
      (e) => e.type === type && e.end !== null && e.start >= dayStart && e.start < dayEnd,
    )
  }

  function getTotalTimeForType(type: TrackerType): number {
    const weekStart = currentWeekStart.value
    return entries.value
      .filter((e) => e.type === type && e.end !== null && e.start >= weekStart)
      .reduce((sum, entry) => sum + (entry.end! - entry.start), 0)
  }

  function getTotalTimeForTypeAndDay(type: TrackerType, dayStart: number, dayEnd: number): number {
    return entries.value
      .filter((e) => e.type === type && e.end !== null && e.start >= dayStart && e.start < dayEnd)
      .reduce((sum, entry) => sum + (entry.end! - entry.start), 0)
  }

  function getCurrentSessionDuration(): number {
    const entry = entries.value.find(e => e.end === null && e.type !== 'idle')
    if (!entry) return 0
    return Date.now() - entry.start
  }

  function getCurrentIdleDuration(): number {
    const entry = entries.value.find(e => e.end === null && e.type === 'idle')
    if (!entry) return 0
    return Date.now() - entry.start
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

  function resetStaleProgressCheck() {
    // Clear focus mode if its end time has passed (tab was closed).
    if (progressCheck.value.focusModeUntil !== null &&
        progressCheck.value.focusModeUntil <= Date.now()) {
      progressCheck.value.focusModeUntil = null
    }
    // Clear snooze if it has expired (tab was closed).
    if (progressCheck.value.snoozeUntil !== null &&
        progressCheck.value.snoozeUntil <= Date.now()) {
      progressCheck.value.snoozeUntil = null
    }
    // Reset redCount if the last check was on a previous day.
    if (progressCheck.value.lastCheck !== null) {
      const last = new Date(progressCheck.value.lastCheck)
      const today = new Date()
      if (last.getFullYear() !== today.getFullYear() ||
          last.getMonth() !== today.getMonth() ||
          last.getDate() !== today.getDate()) {
        progressCheck.value.redCount = 0
      }
    }
  }

  function recordProgressCheck(madeProgress: boolean) {
    if (madeProgress) {
      progressCheck.value.redCount = 0
    } else {
      progressCheck.value.redCount++
    }
    progressCheck.value.lastCheck = Date.now()
  }

  function resetRedCount() {
    progressCheck.value.redCount = 0
  }

  function resetProgressCheck() {
    progressCheck.value.redCount = 0
    progressCheck.value.lastCheck = null
    progressCheck.value.snoozeUntil = null
    progressCheck.value.focusModeUntil = null
    progressCheck.value.nextCheckAt = null
  }

  function snoozeProgressCheck() {
    progressCheck.value.snoozeUntil = Date.now() + 30 * 60 * 1000
  }

  function enableFocusMode() {
    progressCheck.value.focusModeUntil = Date.now() + settings.value.focusModeDuration * 60 * 1000
  }

  function disableFocusMode() {
    progressCheck.value.focusModeUntil = null
  }

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
    if (!('chores' in settings.value.weeklyAllocations)) {
      const allocs = settings.value.weeklyAllocations as any
      const legacy = (allocs.laundry ?? 0) + (allocs.dishes ?? 0)
      settings.value.weeklyAllocations = {
        sleep: allocs.sleep ?? DEFAULT_SETTINGS.weeklyAllocations.sleep,
        cook: allocs.cook ?? DEFAULT_SETTINGS.weeklyAllocations.cook,
        shower: allocs.shower ?? DEFAULT_SETTINGS.weeklyAllocations.shower,
        chores: legacy || DEFAULT_SETTINGS.weeklyAllocations.chores,
        move: allocs.move ?? DEFAULT_SETTINGS.weeklyAllocations.move,
        leisure: allocs.leisure ?? DEFAULT_SETTINGS.weeklyAllocations.leisure,
        unexpected: allocs.unexpected ?? DEFAULT_SETTINGS.weeklyAllocations.unexpected,
        buffer: allocs.buffer ?? DEFAULT_SETTINGS.weeklyAllocations.buffer,
      }
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

  function importWeekData(data: WeekData) {
    entries.value = data.entries
    settings.value = data.settings
    // Push imported data to backend so it survives reload (bulk upsert
    // is idempotent — existing ids are updated, not duplicated).
    enqueueSync({ kind: 'bulk-entries', entries: data.entries.map((e) => ({ ...e })) })
    enqueueSync({ kind: 'settings', settings: { ...settings.value } })
  }

  function getWeekStart(): number {
    const now = new Date()
    const day = now.getDay()
    const diff = (day - settings.value.weekRolloverDay + 7) % 7
    const weekStart = new Date(now)
    weekStart.setDate(now.getDate() - diff)
    weekStart.setHours(settings.value.weekRolloverHour, 0, 0, 0)
    // On the rollover day before the rollover hour the computed start is
    // in the future — the current week actually began 7 days earlier.
    if (weekStart.getTime() > now.getTime()) {
      weekStart.setDate(weekStart.getDate() - 7)
    }
    return weekStart.getTime()
  }

  // Single source of truth for the current week boundary. Recomputes when
  // rollover settings change; entries before this are excluded from totals.
  const currentWeekStart = computed(() => getWeekStart())

  function getDayStart(date: Date = new Date()): number {
    const dayStart = new Date(date)
    dayStart.setHours(0, 0, 0, 0)
    return dayStart.getTime()
  }

  function getDayEnd(date: Date = new Date()): number {
    const dayEnd = new Date(date)
    dayEnd.setHours(23, 59, 59, 999)
    return dayEnd.getTime()
  }

  return {
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
    importWeekData,
    getWeekStart,
    getDayStart,
    getDayEnd,
    initFromBackend,
    syncQueue,
    pendingSyncCount,
    flushSyncQueue,
    currentWeekStart,
  }
}, {
  persist: {
    key: 'megagrind-store',
    storage: localStorage,
    pick: ['entries', 'settings', 'progressCheck', 'syncQueue'],
  },
})
