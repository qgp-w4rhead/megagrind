import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { TimeEntry, TrackerType, WorkCategory, Settings, WeekData } from '../types'
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
      syncEntryUpdateToBackend(openEntry.id, { end: now })
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
    syncEntryToBackend(newEntry)
  }

  function stopSession() {
    const openEntry = entries.value.find(e => e.end === null && e.type !== 'idle')
    if (!openEntry) return

    // Close the active session entry by setting its end time
    const idx = entries.value.indexOf(openEntry)
    const now = Date.now()
    entries.value[idx] = { ...openEntry, end: now }
    syncEntryUpdateToBackend(openEntry.id, { end: now })

    // Start tracking idle time with a new open idle entry
    const idleEntry: TimeEntry = {
      id: generateId(),
      type: 'idle',
      start: Date.now(),
      end: null,
    }
    entries.value.push(idleEntry)
    syncEntryToBackend(idleEntry)

    // Reset progress check when session ends
    progressCheck.value.redCount = 0
    progressCheck.value.lastCheck = null
    progressCheck.value.snoozeUntil = null
    progressCheck.value.focusModeUntil = null
    progressCheck.value.nextCheckAt = null
  }

  async function syncEntryToBackend(entry: TimeEntry) {
    if (settings.value.backendMode === 'local') return
    try {
      await api.createEntry(entry)
    } catch (err) {
      console.warn('[megagrind] Backend sync failed for entry', entry.id, err)
    }
  }

  async function syncEntryDeleteToBackend(id: string) {
    if (settings.value.backendMode === 'local') return
    try {
      await api.deleteEntry(id)
    } catch (err) {
      console.warn('[megagrind] Backend delete sync failed for entry', id, err)
    }
  }

  async function syncEntryUpdateToBackend(id: string, updates: Partial<Omit<TimeEntry, 'id'>>) {
    if (settings.value.backendMode === 'local') return
    try {
      await api.updateEntry(id, updates)
    } catch (err) {
      console.warn('[megagrind] Backend update sync failed for entry', id, err)
    }
  }

  async function syncSettingsToBackend(newSettings: Settings) {
    if (settings.value.backendMode === 'local') return
    try {
      await api.updateSettings(newSettings)
    } catch (err) {
      console.warn('[megagrind] Backend settings sync failed', err)
    }
  }

  async function initFromBackend() {
    if (settings.value.backendMode === 'local') return
    api.setBaseUrl(settings.value.backendUrl)
    api.setBackendMode(settings.value.backendMode)
    try {
      const remoteEntries = await api.getEntries()
      if (remoteEntries.length > 0) {
        const localIds = new Set(entries.value.map((e) => e.id))
        for (const entry of remoteEntries) {
          if (!localIds.has(entry.id)) {
            entries.value.push(entry)
          }
        }
      }
      const remoteSettings = await api.getSettings()
      if (remoteSettings) {
        const { backendMode, backendUrl, ...rest } = remoteSettings
        settings.value = { ...settings.value, ...rest }
      }
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
              syncEntryUpdateToBackend(lastCorrection.id, { balancedWith: fullEntry.id })
            }
          }
        }
      }
    }

    entries.value.push(fullEntry)
    syncEntryToBackend(fullEntry)
  }

  function deleteEntry(id: string) {
    const index = entries.value.findIndex((e) => e.id === id)
    if (index !== -1) {
      entries.value.splice(index, 1)
      syncEntryDeleteToBackend(id)
    }
  }

  function updateEntry(id: string, updates: Partial<Omit<TimeEntry, 'id'>>) {
    const index = entries.value.findIndex((e) => e.id === id)
    if (index !== -1) {
      entries.value[index] = { ...entries.value[index], ...updates } as TimeEntry
      syncEntryUpdateToBackend(id, updates)
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
    return entries.value
      .filter((e) => e.type === type && e.end !== null)
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
    // If nothing is running and there's no open idle entry, create one
    if (!isRunning.value && idleStartTime.value === null) {
      const idleEntry: TimeEntry = {
        id: generateId(),
        type: 'idle',
        start: Date.now(),
        end: null,
      }
      entries.value.push(idleEntry)
      syncEntryToBackend(idleEntry)
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
    syncSettingsToBackend(settings.value)
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
    // Push imported data to backend so it survives reload.
    // Existing entries on the backend will fail silently (caught in sync fn).
    for (const entry of data.entries) {
      syncEntryToBackend(entry)
    }
    syncSettingsToBackend(settings.value)
  }

  function getWeekStart(): number {
    const now = new Date()
    const day = now.getDay()
    const diff = (day - settings.value.weekRolloverDay + 7) % 7
    const weekStart = new Date(now)
    weekStart.setDate(now.getDate() - diff)
    weekStart.setHours(settings.value.weekRolloverHour, 0, 0, 0)
    return weekStart.getTime()
  }

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
  }
}, {
  persist: {
    key: 'megagrind-store',
    storage: localStorage,
    pick: ['entries', 'settings', 'progressCheck'],
  },
})
