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

export type SyncOp =
  | { kind: 'upsert-entry'; entry: TimeEntry }
  | { kind: 'bulk-entries'; entries: TimeEntry[] }
  | { kind: 'delete-entry'; id: string }
  | { kind: 'settings'; settings: Settings }
  | { kind: 'state'; key: string; value: unknown }

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

export const DEFAULT_SETTINGS: Settings = {
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

export const DEFAULT_WORK_CATEGORIES = ['planning', 'research', 'development', 'setup', 'other']

export const DEFAULT_CHORE_CATEGORIES = ['laundry', 'dishes']
