export type TrackerType =
  | 'sleep'
  | 'cook'
  | 'shower'
  | 'chores'
  | 'move'
  | 'leisure'
  | 'unexpected'
  | 'idle'
  | 'work'
  | string

export type WorkCategory = string

export type ChoresCategory = string

export interface TimeEntry {
  id: string
  type: TrackerType
  start: number
  end: number | null
  category?: WorkCategory
  description?: string
  isCorrection?: boolean
  balancedWith?: string | null
}

export interface Settings {
  weeklyAllocations: Record<string, number>
  customChronos: string[]
  choreCategories: string[]
  workCategories: string[]
  weekRolloverDay: number
  weekRolloverHour: number
  notificationsEnabled: boolean
  soundEnabled: boolean
  focusModeDuration: number
  progressCheckInterval: number
  darkMode: 'auto' | 'light' | 'dark'
  backendMode: 'local' | 'sqlite' | 'mongodb'
  backendUrl: string
  idleTimeEnabled: boolean
  progressCheckEnabled: boolean
}

export type DatabaseType = 'sqlite'

export interface DatabaseAdapter {
  readonly type: DatabaseType

  // Entries
  getEntries(weekStart?: number): Promise<TimeEntry[]>
  getEntry(id: string): Promise<TimeEntry | null>
  createEntry(entry: TimeEntry): Promise<TimeEntry>
  updateEntry(id: string, updates: Partial<Omit<TimeEntry, 'id'>>): Promise<TimeEntry>
  deleteEntry(id: string): Promise<void>
  bulkUpsertEntries(entries: TimeEntry[]): Promise<void>

  // Settings
  getSettings(): Promise<Settings | null>
  updateSettings(settings: Settings): Promise<Settings>

  // Key-value state (e.g. progressCheck)
  getState(key: string): Promise<unknown>
  setState(key: string, value: unknown): Promise<void>

  // Lifecycle
  connect(): Promise<void>
  disconnect(): Promise<void>
}
