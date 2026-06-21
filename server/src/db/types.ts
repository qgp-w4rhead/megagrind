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
  darkMode: 'auto' | 'light' | 'dark'
}

export interface WeekData {
  version: number
  weekStart: number
  entries: TimeEntry[]
  settings: Settings
}

export type DatabaseType = 'sqlite' | 'mongodb'

export interface DatabaseAdapter {
  readonly type: DatabaseType

  // Entries
  getEntries(weekStart?: number): Promise<TimeEntry[]>
  getEntry(id: string): Promise<TimeEntry | null>
  createEntry(entry: TimeEntry): Promise<TimeEntry>
  updateEntry(id: string, updates: Partial<Omit<TimeEntry, 'id'>>): Promise<TimeEntry>
  deleteEntry(id: string): Promise<void>

  // Settings
  getSettings(): Promise<Settings | null>
  updateSettings(settings: Settings): Promise<Settings>

  // Weeks (historical archives)
  getWeeks(): Promise<WeekData[]>
  getWeek(weekStart: number): Promise<WeekData | null>
  saveWeek(data: WeekData): Promise<WeekData>

  // Lifecycle
  connect(): Promise<void>
  disconnect(): Promise<void>
}
