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

export interface ProgressEventRow {
  id: string
  sessionId: string
  at: number
  outcome: 'progress' | 'blocked' | 'skipped' | 'snoozed'
}

export interface SyncTombstone {
  id: string
  revision: number
  deletedAt: number
}

export interface SyncSnapshot {
  protocol: 1
  entries: { entry: TimeEntry; revision: number }[]
  entryTombstones: SyncTombstone[]
  preferences: { value: Record<string, unknown>; revision: number } | null
  progressEvents: { event: ProgressEventRow; revision: number }[]
  eventTombstones: SyncTombstone[]
}

export type SyncOperationKind =
  | 'entry-upsert'
  | 'entry-delete'
  | 'entry-restore'
  | 'preferences-replace'
  | 'event-upsert'
  | 'event-delete'

export interface SyncOperationRequest {
  operationId: string
  kind: SyncOperationKind
  baseRevision: number | null
  payload: unknown
}

export type SyncRemoteState =
  | { kind: 'entry'; entry: TimeEntry; revision: number }
  | { kind: 'tombstone'; tombstone: SyncTombstone }
  | { kind: 'preferences'; value: Record<string, unknown>; revision: number }
  | { kind: 'missing'; revision: number | null }

export type SyncOperationResult =
  | { status: 'applied'; resource: string; revision: number; tombstoned?: boolean }
  | { status: 'conflict'; resource: string; remote: SyncRemoteState }
  | { status: 'rejected'; resource: string | null; reason: string }

export interface SyncOperationAck {
  replay: boolean
  result: SyncOperationResult
}

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

  // Sync protocol 1
  getSyncSnapshot(): Promise<SyncSnapshot>
  applySyncOperation(op: SyncOperationRequest): Promise<SyncOperationAck>

  // Lifecycle
  connect(): Promise<void>
  disconnect(): Promise<void>
}
