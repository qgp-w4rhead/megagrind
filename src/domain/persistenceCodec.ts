import { buildDefaultActivities, DEFAULT_SETTINGS } from '../types'
import type { ActivityDefinition, Goal, ProgressEvent, Settings, SyncEnvelope, SyncOpKind, TimeEntry } from '../types'
import { PORTABLE_SETTING_KEYS } from './sync'
import { activityDefinitions } from './activities'
import { PROGRESS_DEFAULTS, type ProgressState } from './progressSchedule'

export interface StoredSnapshotV2 {
  schemaVersion: 2
  entries: TimeEntry[]
  settings: Settings
  progressCheck: ProgressState
  progressEvents: ProgressEvent[]
  progressHistoryStartedAt: number | null
  syncQueue: SyncEnvelope[]
  remoteRevisions: Record<string, number>
  remoteTombstones: Record<string, number>
  lastSyncedAt: number | null
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

const GOAL_POLICIES = new Set(['none', 'target', 'minimum', 'budget'])

function readActivities(v: unknown): ActivityDefinition[] {
  if (v === undefined) return buildDefaultActivities()
  if (!Array.isArray(v)) fail('activities must be an array')
  const seen = new Set<string>()
  const out: ActivityDefinition[] = []
  for (let i = 0; i < v.length; i++) {
    const raw = v[i]
    if (!isPlainObject(raw)) fail(`activities[${i}] must be an object`)
    if (typeof raw.id !== 'string' || raw.id.length === 0) fail(`activities[${i}].id must be a nonempty string`)
    if (UNSAFE_KEYS.has(raw.id)) fail(`unsafe activity id ${raw.id}`)
    if (seen.has(raw.id)) fail(`duplicate activity id ${raw.id}`)
    seen.add(raw.id)
    if (typeof raw.label !== 'string' || raw.label.length === 0) fail(`activities[${i}].label must be a nonempty string`)
    if (raw.favorite !== undefined && typeof raw.favorite !== 'boolean') fail(`activities[${i}].favorite must be a boolean`)
    if (raw.archived !== undefined && typeof raw.archived !== 'boolean') fail(`activities[${i}].archived must be a boolean`)
    const order = readInt(raw.order, 0, 100000, `activities[${i}].order`, i)
    out.push({ id: raw.id, label: raw.label, favorite: raw.favorite === true, archived: raw.archived === true, order })
  }
  return out.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
}

function readGoals(v: unknown): Record<string, Goal> {
  if (v === undefined) return {}
  if (!isPlainObject(v)) fail('goals must be an object')
  const out: Record<string, Goal> = {}
  for (const key of Object.keys(v)) {
    if (UNSAFE_KEYS.has(key)) fail(`unsafe goal key ${key}`)
    const raw = v[key]
    if (!isPlainObject(raw)) fail(`goal ${key} must be an object`)
    if (!GOAL_POLICIES.has(raw.policy as string)) fail(`goal ${key} has an unsupported policy`)
    const hours = raw.hours
    if (typeof hours !== 'number' || !Number.isFinite(hours) || hours < 0 || hours > 168) {
      fail(`goal ${key} hours must be a finite number from 0 to 168`)
    }
    out[key] = { policy: raw.policy as Goal['policy'], hours }
  }
  return out
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
    activities: readActivities(v.activities),
    goals: readGoals(v.goals),
    // An existing store that predates the flag is an established user — never
    // route them through first-use onboarding. Fresh installs never reach this
    // reader: they hydrate from DEFAULT_SETTINGS (onboardingCompleted: false).
    onboardingCompleted: v.onboardingCompleted === undefined ? true : readBool(v.onboardingCompleted, 'onboardingCompleted', true),
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

const SYNC_OP_KINDS = new Set<SyncOpKind>([
  'entry-upsert',
  'entry-delete',
  'entry-restore',
  'preferences-replace',
  'event-upsert',
  'event-delete',
])

let legacyOpCounter = 0
function newOperationId(raw: unknown): string {
  if (typeof raw === 'string' && raw.length > 0) return raw
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  legacyOpCounter += 1
  return `op-${Date.now().toString(36)}-${legacyOpCounter}`
}

function readBaseRevision(v: unknown): number | null {
  if (v === undefined || v === null) return null
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) fail('operation baseRevision must be a nonnegative integer or null')
  return v
}

function readEndpointId(v: unknown): string | null {
  if (v === undefined || v === null) return null
  if (typeof v !== 'string' || v.length === 0) fail('operation endpointId must be a string or null')
  return v
}

// Legacy pre-protocol payloads became blocked envelopes: they carry valid
// intent but no endpoint provenance, so they must never flush until the user
// explicitly assigns them to an endpoint.
function blockedEnvelope(kind: SyncOpKind, payload: unknown): SyncEnvelope {
  return {
    operationId: newOperationId(undefined),
    endpointId: null,
    kind,
    payload,
    baseRevision: null,
    status: 'blocked',
    blockedReason: 'Queued before endpoint tracking existed. Assign these changes to a server endpoint to send them.',
    attempts: 0,
  }
}

function readPortablePrefsPayload(v: unknown): Record<string, unknown> {
  if (!isPlainObject(v)) fail('preferences payload must be an object')
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(v)) {
    if (!(PORTABLE_SETTING_KEYS as readonly string[]).includes(key)) continue
    out[key] = structuredClone(v[key])
  }
  return out
}

function readQueue(v: unknown): SyncEnvelope[] {
  if (v === undefined) return []
  if (!Array.isArray(v)) fail('syncQueue must be an array')
  const out: SyncEnvelope[] = []
  for (const raw of v) {
    if (!isPlainObject(raw)) fail('sync op must be an object')
    // Current envelope shape.
    if (SYNC_OP_KINDS.has(raw.kind as SyncOpKind)) {
      const status = raw.status === 'blocked' ? 'blocked' : 'pending'
      let payload: unknown
      switch (raw.kind as SyncOpKind) {
        case 'entry-upsert':
        case 'entry-restore': {
          const [entry] = readEntries([raw.payload])
          payload = entry
          break
        }
        case 'entry-delete':
        case 'event-delete': {
          if (!isPlainObject(raw.payload) || typeof raw.payload.id !== 'string' || raw.payload.id.length === 0) {
            fail('delete op payload needs a nonempty id')
          }
          payload = { id: raw.payload.id }
          break
        }
        case 'preferences-replace':
          payload = readPortablePrefsPayload(raw.payload)
          break
        case 'event-upsert': {
          const [event] = readProgressEvents([raw.payload])
          payload = event
          break
        }
      }
      const endpointId = readEndpointId(raw.endpointId)
      const unbound = status === 'pending' && endpointId === null
      out.push({
        operationId: newOperationId(raw.operationId),
        endpointId,
        kind: raw.kind as SyncOpKind,
        payload,
        baseRevision: readBaseRevision(raw.baseRevision),
        status: unbound ? 'blocked' : status,
        blockedReason: unbound
          ? 'Queued before endpoint tracking existed. Assign these changes to a server endpoint to send them.'
          : readOptionalString(raw.blockedReason, 'blockedReason') ?? null,
        attempts: 0,
      })
      continue
    }
    // Legacy pre-protocol ops.
    switch (raw.kind) {
      case 'upsert-entry': {
        const [entry] = readEntries([raw.entry])
        out.push(blockedEnvelope('entry-upsert', entry))
        break
      }
      case 'bulk-entries':
        for (const entry of readEntries(raw.entries)) out.push(blockedEnvelope('entry-upsert', entry))
        break
      case 'delete-entry':
        if (typeof raw.id !== 'string' || raw.id.length === 0) fail('delete op id must be a nonempty string')
        out.push(blockedEnvelope('entry-delete', { id: raw.id }))
        break
      case 'settings':
        if (!isPlainObject(raw.settings)) fail('settings op payload must be an object')
        out.push(blockedEnvelope('preferences-replace', readPortablePrefsPayload(raw.settings)))
        break
      case 'state':
        // Device-local progress state never synchronizes: drop the op.
        break
      default:
        fail('unsupported sync op kind')
    }
  }
  return out
}

function readRevisionMap(v: unknown, label: string): Record<string, number> {
  if (v === undefined) return {}
  if (!isPlainObject(v)) fail(`${label} must be an object`)
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(v)) {
    if (UNSAFE_KEYS.has(key)) continue
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      fail(`${label}.${key} must be a nonnegative integer`)
    }
    out[key] = value
  }
  return out
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
    remoteRevisions: s.remoteRevisions,
    remoteTombstones: s.remoteTombstones,
    lastSyncedAt: s.lastSyncedAt,
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
      remoteRevisions: readRevisionMap(parsed.remoteRevisions, 'remoteRevisions'),
      remoteTombstones: readRevisionMap(parsed.remoteTombstones, 'remoteTombstones'),
      lastSyncedAt: readNullableTime(parsed.lastSyncedAt, 'lastSyncedAt'),
    }
    // A persisted store means an established user: cover every activity id
    // they already have (custom chronos, history-only types) and never show
    // first-use onboarding when the flag was never stored.
    snapshot.settings.activities = activityDefinitions(
      snapshot.settings.customChronos,
      snapshot.entries.map((e) => e.type),
      snapshot.settings.activities,
    )
    if (!isPlainObject(parsed.settings) || parsed.settings.onboardingCompleted === undefined) {
      snapshot.settings.onboardingCompleted = true
    }
    return { kind: 'ok', sourceVersion, snapshot }
  } catch (err) {
    return { kind: 'recovery', reason: err instanceof Error ? err.message : 'unreadable cache' }
  }
}
