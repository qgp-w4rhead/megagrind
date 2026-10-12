import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type {
  DatabaseAdapter,
  DatabaseType,
  ProgressEventRow,
  Settings,
  SyncOperationAck,
  SyncOperationRequest,
  SyncOperationResult,
  SyncRemoteState,
  SyncSnapshot,
  SyncTombstone,
  TimeEntry,
} from './types.js'

interface EntryRow {
  id: string
  type: string
  start: number
  end: number | null
  category: string | null
  description: string | null
  isCorrection: number | null
  balancedWith: string | null
}

interface SettingsRow {
  data: string
}

interface TombstoneRow {
  resource: string
  id: string
  kind: 'entry' | 'event'
  revision: number
  deletedAt: number
}

// Preference keys that may travel between devices. Device URL/mode/theme,
// notification permission, sound, and credentials never enter this set.
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

// Deterministic JSON for operationId request comparison: object keys are
// emitted in sorted order so logically identical requests always compare equal.
function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value)
}

const MAX_TIME = 8.64e15

function isFiniteTime(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && Math.abs(v) <= MAX_TIME
}

function isEntryPayload(v: unknown): v is TimeEntry {
  if (typeof v !== 'object' || v === null) return false
  const e = v as Record<string, unknown>
  return (
    typeof e.id === 'string' &&
    e.id.length > 0 &&
    typeof e.type === 'string' &&
    e.type.length > 0 &&
    isFiniteTime(e.start) &&
    (e.end === null || isFiniteTime(e.end))
  )
}

function isEventPayload(v: unknown): v is ProgressEventRow {
  if (typeof v !== 'object' || v === null) return false
  const e = v as Record<string, unknown>
  return (
    typeof e.id === 'string' &&
    e.id.length > 0 &&
    typeof e.sessionId === 'string' &&
    e.sessionId.length > 0 &&
    isFiniteTime(e.at) &&
    (e.outcome === 'progress' || e.outcome === 'blocked' || e.outcome === 'skipped' || e.outcome === 'snoozed')
  )
}

function isIdPayload(v: unknown): v is { id: string } {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Record<string, unknown>).id === 'string' &&
    ((v as Record<string, unknown>).id as string).length > 0
  )
}

export class SQLiteDatabaseAdapter implements DatabaseAdapter {
  readonly type: DatabaseType = 'sqlite'
  private db: Database.Database | null = null
  private dbPath: string

  constructor(dbPath: string) {
    this.dbPath = dbPath
  }

  async connect(): Promise<void> {
    mkdirSync(dirname(this.dbPath), { recursive: true })
    this.db = new Database(this.dbPath)
    this.db.pragma('journal_mode = WAL')

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS entries (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        start INTEGER NOT NULL,
        end INTEGER,
        category TEXT,
        description TEXT,
        isCorrection INTEGER,
        balancedWith TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_entries_start ON entries(start);
    `)

    // Migrate pre-existing tables that lack the correction columns.
    const cols = this.db.prepare("PRAGMA table_info(entries)").all() as { name: string }[]
    const colNames = new Set(cols.map((c) => c.name))
    if (!colNames.has('isCorrection')) {
      this.db.exec('ALTER TABLE entries ADD COLUMN isCorrection INTEGER')
    }
    if (!colNames.has('balancedWith')) {
      this.db.exec('ALTER TABLE entries ADD COLUMN balancedWith TEXT')
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY DEFAULT 1,
        data TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sync_revisions (
        resource TEXT PRIMARY KEY,
        revision INTEGER NOT NULL CHECK (revision >= 0)
      );
      CREATE TABLE IF NOT EXISTS sync_tombstones (
        resource TEXT PRIMARY KEY,
        id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('entry', 'event')),
        revision INTEGER NOT NULL,
        deletedAt INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sync_operations (
        operationId TEXT PRIMARY KEY,
        request TEXT NOT NULL,
        result TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS progress_events (
        id TEXT PRIMARY KEY,
        sessionId TEXT NOT NULL,
        at INTEGER NOT NULL,
        outcome TEXT NOT NULL CHECK (outcome IN ('progress', 'blocked', 'skipped', 'snoozed'))
      );
    `)
  }

  async disconnect(): Promise<void> {
    this.db?.close()
    this.db = null
  }

  private getDB(): Database.Database {
    if (!this.db) throw new Error('SQLite adapter not connected')
    return this.db
  }

  private rowToEntry(row: EntryRow): TimeEntry {
    return {
      id: row.id,
      type: row.type as TimeEntry['type'],
      start: row.start,
      end: row.end,
      ...(row.category ? { category: row.category as TimeEntry['category'] } : {}),
      ...(row.description ? { description: row.description } : {}),
      ...(row.isCorrection ? { isCorrection: true } : {}),
      ...(row.balancedWith != null ? { balancedWith: row.balancedWith } : {}),
    }
  }

  // --- Revision / tombstone helpers -------------------------------------
  // Resource names: 'entry:<id>', 'event:<id>', 'preferences'. New resources
  // begin at revision 0; every accepted change advances by exactly 1.

  private getRevision(resource: string): number | null {
    const db = this.getDB()
    const row = db.prepare('SELECT revision FROM sync_revisions WHERE resource = ?').get(resource) as
      | { revision: number }
      | undefined
    return row?.revision ?? null
  }

  private setRevision(resource: string, revision: number): void {
    const db = this.getDB()
    db.prepare(
      'INSERT INTO sync_revisions (resource, revision) VALUES (?, ?) ON CONFLICT(resource) DO UPDATE SET revision = excluded.revision',
    ).run(resource, revision)
  }

  private bumpRevision(resource: string): number {
    const next = (this.getRevision(resource) ?? -1) + 1
    this.setRevision(resource, next)
    return next
  }

  private getTombstoneRow(resource: string): TombstoneRow | null {
    const db = this.getDB()
    const row = db
      .prepare('SELECT id, kind, revision, deletedAt FROM sync_tombstones WHERE resource = ?')
      .get(resource) as Omit<TombstoneRow, 'resource'> | undefined
    return row ? { resource, ...row } : null
  }

  private writeTombstone(resource: string, id: string, kind: 'entry' | 'event', revision: number): void {
    const db = this.getDB()
    db.prepare(
      `INSERT INTO sync_tombstones (resource, id, kind, revision, deletedAt) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(resource) DO UPDATE SET id = excluded.id, kind = excluded.kind,
       revision = excluded.revision, deletedAt = excluded.deletedAt`,
    ).run(resource, id, kind, revision, Date.now())
    this.setRevision(resource, revision)
  }

  private clearTombstone(resource: string): void {
    const db = this.getDB()
    db.prepare('DELETE FROM sync_tombstones WHERE resource = ?').run(resource)
  }

  private upsertEntryRow(entry: TimeEntry): void {
    const db = this.getDB()
    db.prepare(
      `INSERT INTO entries (id, type, start, "end", category, description, isCorrection, balancedWith)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET type = excluded.type, start = excluded.start,
       "end" = excluded."end", category = excluded.category, description = excluded.description,
       isCorrection = excluded.isCorrection, balancedWith = excluded.balancedWith`,
    ).run(
      entry.id,
      entry.type,
      entry.start,
      entry.end,
      entry.category ?? null,
      entry.description ?? null,
      entry.isCorrection ? 1 : 0,
      entry.balancedWith ?? null,
    )
  }

  private tombstoneOf(row: TombstoneRow): SyncTombstone {
    return { id: row.id, revision: row.revision, deletedAt: row.deletedAt }
  }

  async getEntries(weekStart?: number): Promise<TimeEntry[]> {
    const db = this.getDB()
    if (weekStart !== undefined) {
      const weekEnd = weekStart + 7 * 24 * 60 * 60 * 1000
      const rows = db
        .prepare('SELECT * FROM entries WHERE start >= ? AND start < ? ORDER BY start ASC')
        .all(weekStart, weekEnd) as EntryRow[]
      return rows.map((r) => this.rowToEntry(r))
    }
    const rows = db.prepare('SELECT * FROM entries ORDER BY start ASC').all() as EntryRow[]
    return rows.map((r) => this.rowToEntry(r))
  }

  async getEntry(id: string): Promise<TimeEntry | null> {
    const db = this.getDB()
    const row = db.prepare('SELECT * FROM entries WHERE id = ?').get(id) as EntryRow | undefined
    return row ? this.rowToEntry(row) : null
  }

  async createEntry(entry: TimeEntry): Promise<TimeEntry> {
    const db = this.getDB()
    const run = db.transaction(() => {
      this.upsertEntryRow(entry)
      this.bumpRevision(`entry:${entry.id}`)
    })
    run()
    return entry
  }

  async updateEntry(id: string, updates: Partial<Omit<TimeEntry, 'id'>>): Promise<TimeEntry> {
    const db = this.getDB()
    const existing = await this.getEntry(id)
    if (!existing) throw new Error(`Entry ${id} not found`)

    const merged: TimeEntry = { ...existing, ...updates }
    const run = db.transaction(() => {
      this.upsertEntryRow(merged)
      this.bumpRevision(`entry:${id}`)
    })
    run()
    return merged
  }

  async deleteEntry(id: string): Promise<void> {
    const db = this.getDB()
    const resource = `entry:${id}`
    const run = db.transaction(() => {
      db.prepare('DELETE FROM entries WHERE id = ?').run(id)
      this.clearTombstone(resource)
      const next = (this.getRevision(resource) ?? -1) + 1
      this.writeTombstone(resource, id, 'entry', next)
    })
    run()
  }

  async bulkUpsertEntries(entries: TimeEntry[]): Promise<void> {
    const db = this.getDB()
    const runAll = db.transaction((rows: TimeEntry[]) => {
      for (const e of rows) {
        this.upsertEntryRow(e)
        this.bumpRevision(`entry:${e.id}`)
      }
    })
    runAll(entries)
  }

  async getSettings(): Promise<Settings | null> {
    const db = this.getDB()
    const row = db.prepare('SELECT data FROM settings WHERE id = 1').get() as
      | SettingsRow
      | undefined
    if (!row) return null
    try {
      return JSON.parse(row.data) as Settings
    } catch {
      console.warn('[sqlite] Corrupted settings JSON, returning null')
      return null
    }
  }

  async updateSettings(settings: Settings): Promise<Settings> {
    const db = this.getDB()
    const data = JSON.stringify(settings)
    const run = db.transaction(() => {
      db.prepare(
        'INSERT INTO settings (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data',
      ).run(data)
      this.bumpRevision('preferences')
    })
    run()
    return settings
  }

  async getState(key: string): Promise<unknown> {
    const db = this.getDB()
    const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    if (!row) return null
    try {
      return JSON.parse(row.value)
    } catch {
      console.warn(`[sqlite] Corrupted state JSON for key=${key}, returning null`)
      return null
    }
  }

  async setState(key: string, value: unknown): Promise<void> {
    const db = this.getDB()
    db.prepare(
      'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ).run(key, JSON.stringify(value))
  }

  // --- Sync protocol 1 ----------------------------------------------------

  private portablePreferencesOf(settings: Settings | null): Record<string, unknown> | null {
    if (!settings) return null
    const source = settings as unknown as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of PORTABLE_SETTING_KEYS) {
      if (key in source) out[key] = source[key]
    }
    return out
  }

  async getSyncSnapshot(): Promise<SyncSnapshot> {
    const db = this.getDB()
    const entries = db
      .prepare(
        `SELECT e.*, COALESCE(r.revision, 0) AS revision FROM entries AS e
         LEFT JOIN sync_revisions AS r ON r.resource = 'entry:' || e.id
         ORDER BY e.start ASC, e.id ASC`,
      )
      .all() as (EntryRow & { revision: number })[]
    const tombstones = (kind: 'entry' | 'event') =>
      db
        .prepare('SELECT id, revision, deletedAt FROM sync_tombstones WHERE kind = ? ORDER BY deletedAt ASC, id ASC')
        .all(kind) as SyncTombstone[]
    const settingsRow = db.prepare('SELECT data FROM settings WHERE id = 1').get() as SettingsRow | undefined
    let settings: Settings | null = null
    if (settingsRow) {
      try {
        settings = JSON.parse(settingsRow.data) as Settings
      } catch {
        settings = null
      }
    }
    const prefValue = this.portablePreferencesOf(settings)
    const events = db
      .prepare(
        `SELECT p.*, COALESCE(r.revision, 0) AS revision FROM progress_events AS p
         LEFT JOIN sync_revisions AS r ON r.resource = 'event:' || p.id
         ORDER BY p.at ASC, p.id ASC`,
      )
      .all() as (ProgressEventRow & { revision: number })[]
    return {
      protocol: 1,
      entries: entries.map((row) => ({ entry: this.rowToEntry(row), revision: row.revision })),
      entryTombstones: tombstones('entry'),
      preferences:
        prefValue !== null
          ? { value: prefValue, revision: this.getRevision('preferences') ?? 0 }
          : null,
      progressEvents: events.map(({ id, sessionId, at, outcome, revision }) => ({
        event: { id, sessionId, at, outcome },
        revision,
      })),
      eventTombstones: tombstones('event'),
    }
  }

  async applySyncOperation(op: SyncOperationRequest): Promise<SyncOperationAck> {
    const db = this.getDB()
    const request = canonicalize({ kind: op.kind, baseRevision: op.baseRevision, payload: op.payload })
    const prior = db
      .prepare('SELECT request, result FROM sync_operations WHERE operationId = ?')
      .get(op.operationId) as { request: string; result: string } | undefined
    if (prior) {
      if (prior.request === request) {
        return { replay: true, result: JSON.parse(prior.result) as SyncOperationResult }
      }
      return {
        replay: false,
        result: {
          status: 'rejected',
          resource: null,
          reason: 'operationId was already used with a different request',
        },
      }
    }
    const run = db.transaction(() => {
      const result = this.applyOperationBody(op)
      db.prepare('INSERT INTO sync_operations (operationId, request, result) VALUES (?, ?, ?)').run(
        op.operationId,
        request,
        JSON.stringify(result),
      )
      return result
    })
    const result = run.immediate() as SyncOperationResult
    return { replay: false, result }
  }

  private applyOperationBody(op: SyncOperationRequest): SyncOperationResult {
    switch (op.kind) {
      case 'entry-upsert':
        return this.applyEntryUpsert(op)
      case 'entry-delete':
        return this.applyEntryDelete(op)
      case 'entry-restore':
        return this.applyEntryRestore(op)
      case 'preferences-replace':
        return this.applyPreferencesReplace(op)
      case 'event-upsert':
        return this.applyEventUpsert(op)
      case 'event-delete':
        return this.applyEventDelete(op)
      default:
        return { status: 'rejected', resource: null, reason: 'unsupported operation kind' }
    }
  }

  private applyEntryUpsert(op: SyncOperationRequest): SyncOperationResult {
    if (!isEntryPayload(op.payload)) {
      return { status: 'rejected', resource: null, reason: 'entry-upsert payload is not a valid entry' }
    }
    const entry = op.payload
    const resource = `entry:${entry.id}`
    const tomb = this.getTombstoneRow(resource)
    if (tomb) {
      return { status: 'conflict', resource, remote: { kind: 'tombstone', tombstone: this.tombstoneOf(tomb) } }
    }
    const revision = this.getRevision(resource)
    const remoteEntry = this.getEntrySync(entry.id)
    const remote: SyncRemoteState = remoteEntry
      ? { kind: 'entry', entry: remoteEntry, revision: revision ?? 0 }
      : { kind: 'missing', revision }
    if (op.baseRevision === null) {
      if (revision !== null || remoteEntry) {
        return { status: 'conflict', resource, remote }
      }
      this.upsertEntryRow(entry)
      this.setRevision(resource, 0)
      return { status: 'applied', resource, revision: 0 }
    }
    if (op.baseRevision !== revision) {
      return { status: 'conflict', resource, remote }
    }
    this.upsertEntryRow(entry)
    const next = (revision ?? -1) + 1
    this.setRevision(resource, next)
    return { status: 'applied', resource, revision: next }
  }

  private applyEntryDelete(op: SyncOperationRequest): SyncOperationResult {
    if (!isIdPayload(op.payload)) {
      return { status: 'rejected', resource: null, reason: 'entry-delete payload needs an id' }
    }
    const resource = `entry:${op.payload.id}`
    const tomb = this.getTombstoneRow(resource)
    if (tomb) {
      return { status: 'applied', resource, revision: tomb.revision, tombstoned: true }
    }
    const revision = this.getRevision(resource)
    const remoteEntry = this.getEntrySync(op.payload.id)
    const remote: SyncRemoteState = remoteEntry
      ? { kind: 'entry', entry: remoteEntry, revision: revision ?? 0 }
      : { kind: 'missing', revision }
    if (op.baseRevision === null) {
      if (revision !== null || remoteEntry) {
        return { status: 'conflict', resource, remote }
      }
      this.getDB().prepare('DELETE FROM entries WHERE id = ?').run(op.payload.id)
      this.writeTombstone(resource, op.payload.id, 'entry', 0)
      return { status: 'applied', resource, revision: 0, tombstoned: true }
    }
    if (op.baseRevision !== revision) {
      return { status: 'conflict', resource, remote }
    }
    this.getDB().prepare('DELETE FROM entries WHERE id = ?').run(op.payload.id)
    const next = (revision ?? -1) + 1
    this.writeTombstone(resource, op.payload.id, 'entry', next)
    return { status: 'applied', resource, revision: next, tombstoned: true }
  }

  private applyEntryRestore(op: SyncOperationRequest): SyncOperationResult {
    if (!isEntryPayload(op.payload)) {
      return { status: 'rejected', resource: null, reason: 'entry-restore payload is not a valid entry' }
    }
    const entry = op.payload
    const resource = `entry:${entry.id}`
    const tomb = this.getTombstoneRow(resource)
    if (!tomb) {
      return { status: 'rejected', resource, reason: 'entry is not deleted remotely; use entry-upsert' }
    }
    if (op.baseRevision !== tomb.revision) {
      return { status: 'conflict', resource, remote: { kind: 'tombstone', tombstone: this.tombstoneOf(tomb) } }
    }
    this.clearTombstone(resource)
    this.upsertEntryRow(entry)
    const next = tomb.revision + 1
    this.setRevision(resource, next)
    return { status: 'applied', resource, revision: next }
  }

  private applyPreferencesReplace(op: SyncOperationRequest): SyncOperationResult {
    if (typeof op.payload !== 'object' || op.payload === null || Array.isArray(op.payload)) {
      return { status: 'rejected', resource: 'preferences', reason: 'preferences payload must be an object' }
    }
    const payload = op.payload as Record<string, unknown>
    for (const key of Object.keys(payload)) {
      if (!(PORTABLE_SETTING_KEYS as readonly string[]).includes(key)) {
        return { status: 'rejected', resource: 'preferences', reason: `device-only setting ${key} cannot be synchronized` }
      }
    }
    const resource = 'preferences'
    const revision = this.getRevision(resource)
    const currentValue = this.portablePreferencesOfSync()
    if (op.baseRevision === null) {
      if (revision !== null || currentValue !== null) {
        return {
          status: 'conflict',
          resource,
          remote: { kind: 'preferences', value: currentValue ?? {}, revision: revision ?? 0 },
        }
      }
      this.mergePortablePreferences(payload)
      this.setRevision(resource, 0)
      return { status: 'applied', resource, revision: 0 }
    }
    if (op.baseRevision !== revision) {
      return {
        status: 'conflict',
        resource,
        remote: { kind: 'preferences', value: currentValue ?? {}, revision: revision ?? 0 },
      }
    }
    this.mergePortablePreferences(payload)
    const next = (revision ?? -1) + 1
    this.setRevision(resource, next)
    return { status: 'applied', resource, revision: next }
  }

  private applyEventUpsert(op: SyncOperationRequest): SyncOperationResult {
    if (!isEventPayload(op.payload)) {
      return { status: 'rejected', resource: null, reason: 'event-upsert payload is not a valid progress event' }
    }
    const event = op.payload
    const resource = `event:${event.id}`
    const tomb = this.getTombstoneRow(resource)
    if (tomb) {
      return { status: 'rejected', resource, reason: 'event was deleted remotely and cannot be republished' }
    }
    const db = this.getDB()
    const existing = db
      .prepare('SELECT id, sessionId, at, outcome FROM progress_events WHERE id = ?')
      .get(event.id) as ProgressEventRow | undefined
    if (existing) {
      if (canonicalize(existing) === canonicalize(event)) {
        return { status: 'applied', resource, revision: this.getRevision(resource) ?? 0 }
      }
      return { status: 'rejected', resource, reason: 'conflicting progress event id' }
    }
    db.prepare('INSERT INTO progress_events (id, sessionId, at, outcome) VALUES (?, ?, ?, ?)').run(
      event.id,
      event.sessionId,
      event.at,
      event.outcome,
    )
    const next = (this.getRevision(resource) ?? -1) + 1
    this.setRevision(resource, next)
    return { status: 'applied', resource, revision: next }
  }

  private applyEventDelete(op: SyncOperationRequest): SyncOperationResult {
    if (!isIdPayload(op.payload)) {
      return { status: 'rejected', resource: null, reason: 'event-delete payload needs an id' }
    }
    const resource = `event:${op.payload.id}`
    const tomb = this.getTombstoneRow(resource)
    if (tomb) {
      return { status: 'applied', resource, revision: tomb.revision, tombstoned: true }
    }
    const revision = this.getRevision(resource)
    if (op.baseRevision !== revision && !(op.baseRevision === null && revision === null)) {
      return { status: 'rejected', resource, reason: 'stale revision for event delete' }
    }
    this.getDB().prepare('DELETE FROM progress_events WHERE id = ?').run(op.payload.id)
    const next = (revision ?? -1) + 1
    this.writeTombstone(resource, op.payload.id, 'event', next)
    return { status: 'applied', resource, revision: next, tombstoned: true }
  }

  private getEntrySync(id: string): TimeEntry | null {
    const db = this.getDB()
    const row = db.prepare('SELECT * FROM entries WHERE id = ?').get(id) as EntryRow | undefined
    return row ? this.rowToEntry(row) : null
  }

  private portablePreferencesOfSync(): Record<string, unknown> | null {
    const db = this.getDB()
    const row = db.prepare('SELECT data FROM settings WHERE id = 1').get() as SettingsRow | undefined
    if (!row) return null
    try {
      return this.portablePreferencesOf(JSON.parse(row.data) as Settings)
    } catch {
      return null
    }
  }

  private mergePortablePreferences(patch: Record<string, unknown>): void {
    const db = this.getDB()
    const row = db.prepare('SELECT data FROM settings WHERE id = 1').get() as SettingsRow | undefined
    let current: Record<string, unknown> = {}
    if (row) {
      try {
        current = JSON.parse(row.data) as Record<string, unknown>
      } catch {
        current = {}
      }
    }
    const merged = { ...current, ...patch }
    db.prepare('INSERT INTO settings (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data').run(
      JSON.stringify(merged),
    )
  }
}
