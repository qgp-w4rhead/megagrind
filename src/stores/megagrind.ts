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
  const activeSession = ref<{
    type: TrackerType | null
    startTime: number | null
    description: string | null
    category: WorkCategory | null
  }>({
    type: null,
    startTime: null,
    description: null,
    category: null,
  })
  const progressCheck = ref({
    lastCheck: null as number | null,
    redCount: 0,
    snoozeUntil: null as number | null,
    focusModeUntil: null as number | null,
  })
  const idleStartTime = ref<number | null>(null)
  const api = useApi()

  const isRunning = computed(() => activeSession.value.type !== null)
  const currentSessionType = computed(() => activeSession.value.type)
  const currentSessionStartTime = computed(() => activeSession.value.startTime)

  function startSession(type: TrackerType, description?: string, category?: WorkCategory) {
    // Save idle time entry if transitioning from idle
    if (idleStartTime.value) {
      entries.value.push({
        id: generateId(),
        type: 'idle',
        start: idleStartTime.value,
        end: Date.now(),
      })
      idleStartTime.value = null
    }

    activeSession.value = {
      type,
      startTime: Date.now(),
      description: description || null,
      category: category || null,
    }
  }

  function stopSession() {
    if (!activeSession.value.type || !activeSession.value.startTime) return

    const entry: TimeEntry = {
      id: generateId(),
      type: activeSession.value.type,
      start: activeSession.value.startTime,
      end: Date.now(),
      category: activeSession.value.category || undefined,
      description: activeSession.value.description || undefined,
    }

    entries.value.push(entry)
    activeSession.value = { type: null, startTime: null, description: null, category: null }

    // Start tracking idle time
    idleStartTime.value = Date.now()

    // Reset progress check when session ends
    progressCheck.value.redCount = 0
    progressCheck.value.lastCheck = null
    progressCheck.value.snoozeUntil = null

    syncEntryToBackend(entry)
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
      (e) => e.type === type && e.start >= dayStart && e.start < dayEnd,
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
    if (!activeSession.value.startTime) return 0
    return Date.now() - activeSession.value.startTime
  }

  function getCurrentIdleDuration(): number {
    if (!idleStartTime.value) return 0
    return Date.now() - idleStartTime.value
  }

  function initIdle() {
    if (!isRunning.value && !idleStartTime.value) {
      idleStartTime.value = Date.now()
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
  },
})
