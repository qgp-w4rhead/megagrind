import { DEFAULT_SETTINGS } from '../types'
import type { ProgressEvent, Settings, SyncOp, TimeEntry } from '../types'
import { PROGRESS_DEFAULTS, type ProgressState } from './progressSchedule'

export interface StoredSnapshotV2 {
  schemaVersion: 2
  entries: TimeEntry[]
  settings: Settings
  progressCheck: ProgressState
  progressEvents: ProgressEvent[]
  progressHistoryStartedAt: number | null
  syncQueue: SyncOp[]
}

export type StoredDecode =
  | { kind: 'empty' }
  | { kind: 'ok'; sourceVersion: 1 | 2; snapshot: StoredSnapshotV2 }
  | { kind: 'recovery'; reason: string }

export class DataError extends Error {}

const MAX_TIME = 8.64e15
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const OWN = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function fail(message: string): never {
  throw new DataError(message)
}

function readTime(v: unknown, label: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || Math.abs(v) > MAX_TIME) fail(`${label} is not a valid timestamp`)
  return v
}

function readOptionalString(v: unknown, label: string): string | undefined {
  if (v === undefined) return undefined
  if (typeof v !== 'string') fail(`${label} must be a string`)
  return v
}

export function readEntries(v: unknown): TimeEntry[] {
  if (!Array.isArray(v)) fail('entries must be an array')
  const seen = new Set<string>()
  return v.map((raw, i) => {
    if (!isPlainObject(raw)) fail(`entries[${i}] must be an object`)
    const id = raw.id
    if (typeof id !== 'string' || id.length === 0) fail(`entries[${i}].id must be a nonempty string`)
    if (seen.has(id)) fail(`duplicate entry id ${id}`)
    seen.add(id)
    if (typeof raw.type !== 'string' || raw.type.length === 0) fail(`entries[${i}].type must be a nonempty string`)
    const start = readTime(raw.start, `entries[${i}].start`)
    const end = raw.end === null ? null : readTime(raw.end, `entries[${i}].end`)
    const entry: TimeEntry = { id, type: raw.type, start, end }
    const category = readOptionalString(raw.category, `entries[${i}].category`)
    if (category !== undefined) entry.category = category
    const description = readOptionalString(raw.description, `entries[${i}].description`)
    if (description !== undefined) entry.description = description
    if (raw.isCorrection !== undefined) {
      if (typeof raw.isCorrection !== 'boolean') fail(`entries[${i}].isCorrection must be a boolean`)
      entry.isCorrection = raw.isCorrection
    }
    if (raw.balancedWith !== undefined) {
      if (raw.balancedWith !== null && typeof raw.balancedWith !== 'string') fail(`entries[${i}].balancedWith must be a string or null`)
      entry.balancedWith = raw.balancedWith
    }
    return entry
  })
}

function readAllocations(v: unknown): Record<string, number> {
  if (!isPlainObject(v)) fail('weeklyAllocations must be an object')
  const copy: Record<string, number> = {}
  for (const key of Object.keys(v)) {
    if (UNSAFE_KEYS.has(key)) fail(`unsafe allocation key ${key}`)
    const value = v[key]
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 168) {
      fail(`allocation ${key} must be a finite number from 0 to 168`)
    }
    copy[key] = value
  }
  if (!OWN(copy, 'chores')) {
    const hasLegacy = OWN(copy, 'laundry') || OWN(copy, 'dishes')
    const chores = hasLegacy ? (copy.laundry ?? 0) + (copy.dishes ?? 0) : DEFAULT_SETTINGS.weeklyAllocations.chores!
    delete copy.laundry
    delete copy.dishes
    return { ...DEFAULT_SETTINGS.weeklyAllocations, ...copy, chores }
  }
  return copy
}

function readInt(v: unknown, min: number, max: number, label: string, fallback: number): number {
  if (v === undefined) return fallback
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) fail(`${label} must be an integer from ${min} to ${max}`)
  return v
}

function readBool(v: unknown, label: string, fallback: boolean): boolean {
  if (v === undefined) return fallback
  if (typeof v !== 'boolean') fail(`${label} must be a boolean`)
  return v
}

function readStringArray(v: unknown, label: string, fallback: string[]): string[] {
  if (v === undefined) return [...fallback]
  if (!Array.isArray(v) || v.some((s) => typeof s !== 'string')) fail(`${label} must be an array of strings`)
  return [...(v as string[])]
}

export function readSettings(v: unknown): Settings {
  if (v === undefined) return structuredClone(DEFAULT_SETTINGS)
  if (!isPlainObject(v)) fail('settings must be an object')
  const d = DEFAULT_SETTINGS
  const allocations = v.weeklyAllocations === undefined ? { ...d.weeklyAllocations } : readAllocations(v.weeklyAllocations)
  const total = Object.values(allocations).reduce((sum, n) => sum + n, 0)
  if (total > 168) fail('allocations exceed 168 hours')
  const darkMode = v.darkMode === undefined ? d.darkMode : v.darkMode
  if (darkMode !== 'auto' && darkMode !== 'light' && darkMode !== 'dark') fail('darkMode is not supported')
  const backendMode = v.backendMode === undefined ? d.backendMode : v.backendMode
  if (backendMode !== 'local' && backendMode !== 'sqlite' && backendMode !== 'mongodb') fail('backendMode is not supported')
  const backendUrl = v.backendUrl === undefined ? d.backendUrl : v.backendUrl
  if (typeof backendUrl !== 'string') fail('backendUrl must be a string')
  return {
    weeklyAllocations: allocations,
    customChronos: readStringArray(v.customChronos, 'customChronos', d.customChronos),
    choreCategories: readStringArray(v.choreCategories, 'choreCategories', d.choreCategories),
    workCategories: readStringArray(v.workCategories, 'workCategories', d.workCategories),
    weekRolloverDay: readInt(v.weekRolloverDay, 0, 6, 'weekRolloverDay', d.weekRolloverDay),
    weekRolloverHour: readInt(v.weekRolloverHour, 0, 23, 'weekRolloverHour', d.weekRolloverHour),
    notificationsEnabled: readBool(v.notificationsEnabled, 'notificationsEnabled', d.notificationsEnabled),
    soundEnabled: readBool(v.soundEnabled, 'soundEnabled', d.soundEnabled),
    focusModeDuration: readInt(v.focusModeDuration, 15, 180, 'focusModeDuration', d.focusModeDuration),
    progressCheckInterval: readInt(v.progressCheckInterval, 5, 60, 'progressCheckInterval', d.progressCheckInterval),
    darkMode,
    backendMode,
    backendUrl,
    idleTimeEnabled: readBool(v.idleTimeEnabled, 'idleTimeEnabled', d.idleTimeEnabled),
    progressCheckEnabled: readBool(v.progressCheckEnabled, 'progressCheckEnabled', d.progressCheckEnabled),
  }
}

const PAUSE_VALUES = ['not-working', 'focus'] as const

function readNullableTime(v: unknown, label: string): number | null {
  return v === undefined || v === null ? null : readTime(v, label)
}

function readNullableId(v: unknown, label: string): string | null {
  if (v === undefined || v === null) return null
  if (typeof v !== 'string') fail(`${label} must be a string or null`)
  return v
}

export function readProgress(v: unknown): ProgressState {
  const base = { ...PROGRESS_DEFAULTS }
  if (v === undefined) return base
  if (!isPlainObject(v)) fail('progressCheck must be an object')
  const redCount = v.redCount === undefined ? 0 : v.redCount
  if (typeof redCount !== 'number' || !Number.isInteger(redCount) || redCount < 0) fail('redCount must be a nonnegative integer')
  let remainingMs: number | null = null
  if (v.remainingMs !== undefined && v.remainingMs !== null) {
    if (typeof v.remainingMs !== 'number' || !Number.isFinite(v.remainingMs) || v.remainingMs < 0) fail('remainingMs must be a finite nonnegative number')
    remainingMs = v.remainingMs
  }
  let pausedReason: ProgressState['pausedReason'] = null
  if (v.pausedReason !== undefined && v.pausedReason !== null) {
    if (!PAUSE_VALUES.includes(v.pausedReason as (typeof PAUSE_VALUES)[number])) fail('pausedReason is not supported')
    pausedReason = v.pausedReason as ProgressState['pausedReason']
  }
  return {
    lastCheck: readNullableTime(v.lastCheck, 'lastCheck'),
    redCount,
    snoozeUntil: readNullableTime(v.snoozeUntil, 'snoozeUntil'),
    focusModeUntil: readNullableTime(v.focusModeUntil, 'focusModeUntil'),
    nextCheckAt: readNullableTime(v.nextCheckAt, 'nextCheckAt'),
    remainingMs,
    pendingSessionId: readNullableId(v.pendingSessionId, 'pendingSessionId'),
    pausedReason,
    sessionId: readNullableId(v.sessionId, 'sessionId'),
  }
}

const OUTCOMES = ['progress', 'blocked', 'skipped', 'snoozed'] as const

export function readProgressEvents(v: unknown): ProgressEvent[] {
  if (v === undefined) return []
  if (!Array.isArray(v)) fail('progressEvents must be an array')
  const byId = new Map<string, ProgressEvent>()
  for (const raw of v) {
    if (!isPlainObject(raw)) fail('progress event must be an object')
    if (typeof raw.id !== 'string' || raw.id.length === 0) fail('progress event id must be a nonempty string')
    if (typeof raw.sessionId !== 'string' || raw.sessionId.length === 0) fail('progress event sessionId must be a nonempty string')
    const at = readTime(raw.at, 'progress event at')
    if (!OUTCOMES.includes(raw.outcome as (typeof OUTCOMES)[number])) fail('progress event outcome is not supported')
    const event: ProgressEvent = { id: raw.id, sessionId: raw.sessionId, at, outcome: raw.outcome as ProgressEvent['outcome'] }
    const existing = byId.get(raw.id)
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(event)) fail(`conflicting duplicate progress event ${raw.id}`)
      continue
    }
    byId.set(raw.id, event)
  }
  return [...byId.values()]
}

function readQueue(v: unknown): SyncOp[] {
  if (v === undefined) return []
  if (!Array.isArray(v)) fail('syncQueue must be an array')
  return v.map((raw) => {
    if (!isPlainObject(raw)) fail('sync op must be an object')
    switch (raw.kind) {
      case 'upsert-entry': {
        const [entry] = readEntries([raw.entry])
        return { kind: 'upsert-entry', entry: entry! }
      }
      case 'bulk-entries':
        return { kind: 'bulk-entries', entries: readEntries(raw.entries) }
      case 'delete-entry':
        if (typeof raw.id !== 'string' || raw.id.length === 0) fail('delete op id must be a nonempty string')
        return { kind: 'delete-entry', id: raw.id }
      case 'settings':
        if (!isPlainObject(raw.settings)) fail('settings op payload must be an object')
        return { kind: 'settings', settings: structuredClone(raw.settings) as unknown as Settings }
      case 'state':
        if (typeof raw.key !== 'string') fail('state op key must be a string')
        return { kind: 'state', key: raw.key, value: structuredClone(raw.value) }
      default:
        fail('unsupported sync op kind')
    }
  })
}

export function encodeStoredSnapshot(s: StoredSnapshotV2): string {
  return JSON.stringify({
    schemaVersion: 2,
    entries: s.entries,
    settings: s.settings,
    progressCheck: s.progressCheck,
    progressEvents: s.progressEvents,
    progressHistoryStartedAt: s.progressHistoryStartedAt,
    syncQueue: s.syncQueue,
  })
}

export function decodeStoredCache(raw: string | null): StoredDecode {
  if (raw === null) return { kind: 'empty' }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isPlainObject(parsed)) fail('cache must be an object')
    if (parsed.schemaVersion !== undefined && parsed.schemaVersion !== 1 && parsed.schemaVersion !== 2) {
      fail('unsupported schema version')
    }
    const sourceVersion: 1 | 2 = parsed.schemaVersion === 2 ? 2 : 1
    const snapshot: StoredSnapshotV2 = {
      schemaVersion: 2,
      entries: readEntries(parsed.entries ?? []),
      settings: readSettings(parsed.settings),
      progressCheck: readProgress(parsed.progressCheck),
      progressEvents: readProgressEvents(parsed.progressEvents),
      progressHistoryStartedAt: readNullableTime(parsed.progressHistoryStartedAt, 'progressHistoryStartedAt'),
      syncQueue: readQueue(parsed.syncQueue),
    }
    return { kind: 'ok', sourceVersion, snapshot }
  } catch (err) {
    return { kind: 'recovery', reason: err instanceof Error ? err.message : 'unreadable cache' }
  }
}
