import type { ProgressEvent, Settings, TimeEntry, TimeRange, TrackerType } from '../types'
import { DataError, readEntries, readProgressEvents, readSettings } from './persistenceCodec'
import { sliceEntries } from './time'

export const STORAGE_KEY = 'megagrind-store'
export const SNAPSHOT_KEY_PREFIX = 'megagrind-recovery-'
export const SNAPSHOT_LIMIT = 5
export const SNAPSHOT_BUDGET_BYTES = 2 * 1024 * 1024
export const IMPORT_LIMIT_BYTES = 50 * 1024 * 1024

const encoder = new TextEncoder()
const PORTABLE_SETTING_KEYS = [
  'weeklyAllocations',
  'customChronos',
  'choreCategories',
  'workCategories',
  'weekRolloverDay',
  'weekRolloverHour',
  'focusModeDuration',
  'progressCheckInterval',
  'idleTimeEnabled',
  'progressCheckEnabled',
] as const

export type PortablePreferences = Pick<Settings, (typeof PORTABLE_SETTING_KEYS)[number]>

export interface FullBackupV2 {
  version: 2
  scope: 'full'
  exportedAt: number
  entries: TimeEntry[]
  preferences: PortablePreferences
  progressEvents: ProgressEvent[]
  progressHistoryStartedAt: number | null
}

export interface PeriodInterval {
  entryId: string
  type: TrackerType
  start: number
  end: number
  duration: number
  description?: string
  category?: string
  isAdjustment: boolean
  isRunning: boolean
}

export interface PeriodReportV2 {
  version: 2
  scope: 'period'
  exportedAt: number
  range: TimeRange
  intervals: PeriodInterval[]
}

export type ImportDocument = { kind: 'full'; backup: FullBackupV2 } | { kind: 'period' }

export interface ImportPreview {
  document: FullBackupV2
  added: string[]
  identical: string[]
  conflicts: string[]
  removed: string[]
  warnings: string[]
  multipleOpenIds: string[]
  progressEventsAdded: number
  progressEventsConflicts: number
}

export interface ImportApplyOptions {
  mode: 'merge' | 'replace'
  conflictChoices?: Record<string, 'local' | 'imported'>
  restorePreferences?: boolean
  eventMode?: 'merge' | 'replace'
  openChoice?: { keepEntryId: string; close: Record<string, number> }
}

export type ImportApplyResult =
  | {
      kind: 'ok'
      entries: TimeEntry[]
      settingsPatch: PortablePreferences | null
      progressEvents: ProgressEvent[]
      progressHistoryStartedAt: number | null
      changedIds: string[]
      warnings: string[]
    }
  | { kind: 'blocked'; reason: string; needs: 'conflicts' | 'open' | 'snapshot' }

export type PersistenceState = 'ready' | 'memory' | 'recovery'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
  key(index: number): string | null
  readonly length: number
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function entriesEqual(a: TimeEntry, b: TimeEntry): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function openIds(entries: readonly TimeEntry[]): string[] {
  return entries.filter((e) => e.end === null).map((e) => e.id)
}

export function byteLength(value: string): number {
  return encoder.encode(value).length
}

export function portablePreferences(settings: Settings): PortablePreferences {
  return {
    weeklyAllocations: clone(settings.weeklyAllocations),
    customChronos: [...settings.customChronos],
    choreCategories: [...settings.choreCategories],
    workCategories: [...settings.workCategories],
    weekRolloverDay: settings.weekRolloverDay,
    weekRolloverHour: settings.weekRolloverHour,
    focusModeDuration: settings.focusModeDuration,
    progressCheckInterval: settings.progressCheckInterval,
    idleTimeEnabled: settings.idleTimeEnabled,
    progressCheckEnabled: settings.progressCheckEnabled,
  }
}

export function makeFullBackup(input: {
  exportedAt: number
  entries: readonly TimeEntry[]
  settings: Settings
  progressEvents: readonly ProgressEvent[]
  progressHistoryStartedAt: number | null
}): FullBackupV2 {
  return {
    version: 2,
    scope: 'full',
    exportedAt: input.exportedAt,
    entries: clone(input.entries) as TimeEntry[],
    preferences: portablePreferences(input.settings),
    progressEvents: clone(input.progressEvents) as ProgressEvent[],
    progressHistoryStartedAt: input.progressHistoryStartedAt,
  }
}

export function makePeriodReport(input: {
  exportedAt: number
  range: TimeRange
  now: number
  entries: readonly TimeEntry[]
}): PeriodReportV2 {
  const intervals = sliceEntries(input.entries, input.range, input.now).map((slice) => ({
    entryId: slice.entry.id,
    type: slice.entry.type,
    start: slice.start,
    end: slice.end,
    duration: slice.duration,
    ...(slice.entry.description === undefined ? {} : { description: slice.entry.description }),
    ...(slice.entry.category === undefined ? {} : { category: slice.entry.category }),
    isAdjustment: slice.isAdjustment,
    isRunning: slice.isRunning,
  }))
  return { version: 2, scope: 'period', exportedAt: input.exportedAt, range: { ...input.range }, intervals }
}

function readTimestamp(v: unknown, label: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || Math.abs(v) > 8.64e15) throw new DataError(`${label} is not a valid timestamp`)
  return v
}

function readPortablePreferences(v: unknown): PortablePreferences {
  const settings = readSettings(v)
  return portablePreferences(settings)
}

export function decodeImportDocument(text: string): ImportDocument {
  if (byteLength(text) > IMPORT_LIMIT_BYTES) throw new DataError('File exceeds the 50 MiB safety limit')
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new DataError('File is not valid JSON')
  }
  if (!isPlainObject(parsed)) throw new DataError('File must contain a JSON object')
  const version = parsed.version
  const scope = parsed.scope ?? (parsed.weekStart !== undefined && parsed.entries !== undefined && parsed.settings !== undefined ? 'legacy-week' : undefined)
  if (version !== 1 && version !== 2) throw new DataError('Unsupported backup version')
  if (scope === 'period') throw new DataError('This is a read-only period report, not a restorable backup')
  if (scope !== 'full' && scope !== 'legacy-week' && scope !== undefined) throw new DataError('Unsupported backup scope')
  const entries = readEntries(parsed.entries)
  const preferences = readPortablePreferences(parsed.preferences ?? parsed.settings)
  const progressEvents = readProgressEvents(parsed.progressEvents)
  const progressHistoryStartedAt = parsed.progressHistoryStartedAt === undefined || parsed.progressHistoryStartedAt === null
    ? null
    : readTimestamp(parsed.progressHistoryStartedAt, 'progressHistoryStartedAt')
  return {
    kind: 'full',
    backup: {
      version: 2,
      scope: 'full',
      exportedAt: readTimestamp(parsed.exportedAt ?? Date.now(), 'exportedAt'),
      entries,
      preferences,
      progressEvents,
      progressHistoryStartedAt,
    },
  }
}

export function previewImport(input: {
  imported: FullBackupV2
  localEntries: readonly TimeEntry[]
  localEvents: readonly ProgressEvent[]
  mode: 'merge' | 'replace'
  now: number
}): ImportPreview {
  const localById = new Map(input.localEntries.map((e) => [e.id, e]))
  const importedById = new Map(input.imported.entries.map((e) => [e.id, e]))
  const added: string[] = []
  const identical: string[] = []
  const conflicts: string[] = []
  for (const [id, incoming] of importedById) {
    const local = localById.get(id)
    if (!local) added.push(id)
    else if (entriesEqual(local, incoming)) identical.push(id)
    else conflicts.push(id)
  }
  const removed = input.mode === 'replace' ? [...localById.keys()].filter((id) => !importedById.has(id)) : []
  const warnings: string[] = []
  if (input.imported.entries.some((e) => e.start > input.now || (e.end !== null && e.end > input.now))) {
    warnings.push('The file contains future timestamps. Review it carefully before restoring.')
  }
  const orphanLinks = input.imported.entries.filter((e) => typeof e.balancedWith === 'string' && e.balancedWith.length > 0 && !importedById.has(e.balancedWith) && !localById.has(e.balancedWith))
  if (orphanLinks.length > 0) warnings.push('Some correction links point to records that are not present.')
  const localOpen = openIds(input.localEntries)
  const importedOpen = openIds(input.imported.entries)
  const multipleOpenIds = [...new Set([...importedOpen, ...localOpen.filter((id) => !importedById.has(id))])]
  const hasMultipleOpen = multipleOpenIds.length > 1
  if (hasMultipleOpen) warnings.push('Restoring this file would create more than one running activity. Choose which one stays open.')
  const localEventIds = new Map(input.localEvents.map((e) => [e.id, e]))
  let progressEventsAdded = 0
  let progressEventsConflicts = 0
  for (const event of input.imported.progressEvents) {
    const local = localEventIds.get(event.id)
    if (!local) progressEventsAdded += 1
    else if (JSON.stringify(local) !== JSON.stringify(event)) progressEventsConflicts += 1
  }
  return {
    document: input.imported,
    added,
    identical,
    conflicts,
    removed,
    warnings,
    multipleOpenIds: hasMultipleOpen ? multipleOpenIds : [],
    progressEventsAdded,
    progressEventsConflicts,
  }
}

function mergeEvents(localEvents: readonly ProgressEvent[], importedEvents: readonly ProgressEvent[], replace: boolean): ProgressEvent[] {
  if (replace) return clone(importedEvents) as ProgressEvent[]
  const byId = new Map<string, ProgressEvent>()
  for (const event of localEvents) byId.set(event.id, { ...event })
  for (const event of importedEvents) {
    const existing = byId.get(event.id)
    if (!existing) byId.set(event.id, { ...event })
    else if (JSON.stringify(existing) !== JSON.stringify(event)) throw new DataError(`Conflicting progress event ${event.id}`)
  }
  return [...byId.values()].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
}

function historyStart(local: number | null, imported: number | null): number | null {
  if (local === null) return imported
  if (imported === null) return local
  return Math.min(local, imported)
}

export function applyImport(input: {
  imported: FullBackupV2
  localEntries: readonly TimeEntry[]
  localSettings: Settings
  localEvents: readonly ProgressEvent[]
  localHistoryStartedAt: number | null
  options: ImportApplyOptions
  now: number
}): ImportApplyResult {
  const preview = previewImport({
    imported: input.imported,
    localEntries: input.localEntries,
    localEvents: input.localEvents,
    mode: input.options.mode,
    now: input.now,
  })
  const unresolved = preview.conflicts.filter((id) => input.options.conflictChoices?.[id] !== 'local' && input.options.conflictChoices?.[id] !== 'imported')
  if (unresolved.length > 0) {
    return { kind: 'blocked', reason: 'Choose whether each changed record keeps the local or imported version.', needs: 'conflicts' }
  }
  const localById = new Map(input.localEntries.map((e) => [e.id, e]))
  const importedById = new Map(input.imported.entries.map((e) => [e.id, e]))
  const next = new Map<string, TimeEntry>()
  if (input.options.mode === 'merge') {
    for (const [id, local] of localById) next.set(id, { ...local })
    for (const [id, imported] of importedById) {
      if (!localById.has(id) || input.options.conflictChoices?.[id] === 'imported') next.set(id, { ...imported })
    }
  } else {
    for (const [id, imported] of importedById) next.set(id, { ...imported })
    for (const id of preview.conflicts) {
      if (input.options.conflictChoices?.[id] === 'local') next.set(id, { ...localById.get(id)! })
    }
  }
  const open = openIds([...next.values()])
  if (open.length > 1) {
    const choice = input.options.openChoice
    if (!choice || !open.includes(choice.keepEntryId)) {
      return { kind: 'blocked', reason: 'Choose which running activity stays open before restoring.', needs: 'open' }
    }
    for (const id of open) {
      if (id === choice.keepEntryId) continue
      const end = choice.close[id]
      if (typeof end !== 'number' || !Number.isInteger(end) || Math.abs(end) > 8.64e15) {
        return { kind: 'blocked', reason: 'Every extra running activity needs an explicit finish time.', needs: 'open' }
      }
      const entry = next.get(id)!
      if (end < entry.start) return { kind: 'blocked', reason: 'A finish time cannot be before that activity started.', needs: 'open' }
      next.set(id, { ...entry, end })
    }
  }
  const events = mergeEvents(input.localEvents, input.imported.progressEvents, input.options.eventMode === 'replace')
  const warnings = [...preview.warnings]
  const changedIds = [...next.keys()].filter((id) => !localById.has(id) || !entriesEqual(localById.get(id)!, next.get(id)!))
  return {
    kind: 'ok',
    entries: [...next.values()].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id)),
    settingsPatch: input.options.restorePreferences ? input.imported.preferences : null,
    progressEvents: events,
    progressHistoryStartedAt: historyStart(input.localHistoryStartedAt, input.imported.progressHistoryStartedAt),
    changedIds,
    warnings,
  }
}

export function snapshotKey(index: number): string {
  return `${SNAPSHOT_KEY_PREFIX}${index}`
}

export function listRecoveryKeys(storage: StorageLike): string[] {
  const keys: string[] = []
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i)
    if (key?.startsWith(SNAPSHOT_KEY_PREFIX)) keys.push(key)
  }
  return keys.sort()
}

export function recoveryBytes(storage: StorageLike): number {
  return listRecoveryKeys(storage).reduce((sum, key) => sum + byteLength(storage.getItem(key) ?? ''), 0)
}

export function writeRecoverySnapshot(storage: StorageLike, raw: string): string | null {
  if (raw.length === 0 || byteLength(raw) > SNAPSHOT_BUDGET_BYTES) return null
  const keys = listRecoveryKeys(storage)
  let nextIndex = keys.length
  const parsed = keys.map((key) => Number(key.slice(SNAPSHOT_KEY_PREFIX.length))).filter((n) => Number.isInteger(n))
  if (parsed.length > 0) nextIndex = Math.max(...parsed) + 1
  const key = snapshotKey(nextIndex)
  try {
    storage.setItem(key, raw)
  } catch {
    return null
  }
  if (storage.getItem(key) !== raw) {
    try { storage.removeItem(key) } catch { /* leave failed state untouched */ }
    return null
  }
  const after = listRecoveryKeys(storage)
  const extras = after.slice(0, Math.max(0, after.length - SNAPSHOT_LIMIT))
  for (const oldKey of extras) {
    if (byteLength(storage.getItem(oldKey) ?? '') > 0) {
      try { storage.removeItem(oldKey) } catch { /* rotation cannot repair quota */ }
    }
  }
  if (recoveryBytes(storage) > SNAPSHOT_BUDGET_BYTES) {
    try { storage.removeItem(key) } catch { /* keep the attempted snapshot unavailable */ }
    return null
  }
  return key
}
