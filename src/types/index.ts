export type TrackerType = 'sleep' | 'cook' | 'shower' | 'chores' | 'move' | 'leisure' | 'unexpected' | 'idle' | 'work' | (string & {})

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

export interface TimeRange {
  start: number
  end: number
}

export interface EntrySlice {
  entry: TimeEntry
  start: number
  end: number
  duration: number
  isAdjustment: boolean
  isRunning: boolean
}

export interface ActivityDefinition {
  id: TrackerType
  label: string
  favorite: boolean
  archived: boolean
  order: number
}

export interface Goal {
  policy: 'none' | 'target' | 'minimum' | 'budget'
  hours: number
}

export interface ProgressEvent {
  id: string
  sessionId: string
  at: number
  outcome: 'progress' | 'blocked' | 'skipped' | 'snoozed'
}

export interface WeekData {
  version: number
  weekStart: number
  entries: TimeEntry[]
  settings: Settings
}

// Sync protocol 1 outbox. Each queued change is an immutable envelope:
// operationId is generated at enqueue and never reused, endpointId records
// which backend configuration the change was captured for (never sent to a
// different server), payload is a deep snapshot taken at enqueue time, and
// baseRevision is filled with the last-known remote revision right before the
// operation is sent for compare-and-swap.
export type SyncOpKind =
  | 'entry-upsert'
  | 'entry-delete'
  | 'entry-restore'
  | 'preferences-replace'
  | 'event-upsert'
  | 'event-delete'

export interface SyncEnvelope {
  operationId: string
  endpointId: string | null
  kind: SyncOpKind
  payload: unknown
  baseRevision: number | null
  status: 'pending' | 'blocked'
  blockedReason: string | null
  attempts: number
}

// A divergence between this device and the server that needs an explicit
// choice. `local`/`remote` hold the preserved copies; `remote` is null when
// the server has no record for the resource.
export interface SyncConflictInfo {
  resource: string
  remoteKind: 'entry' | 'preferences' | 'tombstone' | 'missing'
  local: unknown | null
  remote: unknown | null
  remoteRevision: number | null
  label: string
}

export type SyncStatus =
  | 'local'
  | 'offline'
  | 'pending'
  | 'syncing'
  | 'synced'
  | 'conflict'
  | 'failed'

export interface Settings {
  weeklyAllocations: Record<string, number>
  // M1.2 additive preference fields: activity display metadata, per-activity
  // goal policies, and whether this device finished (or skipped) first-use
  // setup. activities/goals are portable preferences; onboardingCompleted is
  // device-local and never syncs.
  activities: ActivityDefinition[]
  goals: Record<string, Goal>
  onboardingCompleted: boolean
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

export interface TrackerState {
  activeSession: {
    type: TrackerType | null
    startTime: number | null
  }
  progressCheck: {
    lastCheck: number | null
    redCount: number
    snoozeUntil: number | null
    focusModeUntil: number | null
  }
}

export const TRACKER_LABELS: Record<string, string> = {
  sleep: 'Sleep',
  cook: 'Cook/Eat',
  shower: 'Shower',
  chores: 'Chores',
  move: 'Move',
  leisure: 'Leisure',
  unexpected: 'Unexpected',
  idle: 'Idle Time',
  work: 'Work',
}

// Built-in activity seed: display order matches BUILT_IN_ACTIVITIES. All
// start unfavorited so the Today list keeps its recency-driven behavior until
// the user makes an explicit choice (M5.1/M7.1 own richer management).
export const BUILT_IN_ACTIVITY_IDS = [
  'work',
  'chores',
  'sleep',
  'cook',
  'shower',
  'move',
  'leisure',
  'unexpected',
  'buffer',
] as const

export function buildDefaultActivities(): ActivityDefinition[] {
  return BUILT_IN_ACTIVITY_IDS.map((id, order) => ({
    id,
    label: TRACKER_LABELS[id] ?? id.charAt(0).toUpperCase() + id.slice(1),
    favorite: false,
    archived: false,
    order,
  }))
}

export const DEFAULT_SETTINGS: Settings = {
  activities: buildDefaultActivities(),
  goals: {},
  onboardingCompleted: false,
  weeklyAllocations: {
    sleep: 49,
    cook: 7,
    shower: 2.33,
    chores: 7,
    move: 3.5,
    leisure: 7,
    unexpected: 2,
    buffer: 2,
  },
  customChronos: [],
  choreCategories: ['laundry', 'dishes'],
  workCategories: ['planning', 'research', 'development', 'setup', 'other'],
  weekRolloverDay: 0,
  weekRolloverHour: 0,
  notificationsEnabled: true,
  soundEnabled: false,
  focusModeDuration: 90,
  progressCheckInterval: 15,
  darkMode: 'auto',
  backendMode: 'local',
  backendUrl: '',
  idleTimeEnabled: true,
  progressCheckEnabled: true,
}

export function createDefaultSettings(): Settings {
  return structuredClone(DEFAULT_SETTINGS)
}

export const DEFAULT_WORK_CATEGORIES = ['planning', 'research', 'development', 'setup', 'other']

export const DEFAULT_CHORE_CATEGORIES = ['laundry', 'dishes']
