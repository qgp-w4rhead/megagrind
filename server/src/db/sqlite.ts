import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type {
  DatabaseAdapter,
  DatabaseType,
  Settings,
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
    db.prepare(
      'INSERT INTO entries (id, type, start, end, category, description, isCorrection, balancedWith) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
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
    return entry
  }

  async updateEntry(id: string, updates: Partial<Omit<TimeEntry, 'id'>>): Promise<TimeEntry> {
    const db = this.getDB()
    const existing = await this.getEntry(id)
    if (!existing) throw new Error(`Entry ${id} not found`)

    const merged: TimeEntry = { ...existing, ...updates }
    db.prepare(
      'UPDATE entries SET type = ?, start = ?, end = ?, category = ?, description = ?, isCorrection = ?, balancedWith = ? WHERE id = ?',
    ).run(
      merged.type,
      merged.start,
      merged.end,
      merged.category ?? null,
      merged.description ?? null,
      merged.isCorrection ? 1 : 0,
      merged.balancedWith ?? null,
      id,
    )
    return merged
  }

  async deleteEntry(id: string): Promise<void> {
    const db = this.getDB()
    db.prepare('DELETE FROM entries WHERE id = ?').run(id)
  }

  async bulkUpsertEntries(entries: TimeEntry[]): Promise<void> {
    const db = this.getDB()
    const stmt = db.prepare(
      `INSERT INTO entries (id, type, start, end, category, description, isCorrection, balancedWith)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         type = excluded.type,
         start = excluded.start,
         end = excluded.end,
         category = excluded.category,
         description = excluded.description,
         isCorrection = excluded.isCorrection,
         balancedWith = excluded.balancedWith`,
    )
    const runAll = db.transaction((rows: TimeEntry[]) => {
      for (const e of rows) {
        stmt.run(
          e.id,
          e.type,
          e.start,
          e.end,
          e.category ?? null,
          e.description ?? null,
          e.isCorrection ? 1 : 0,
          e.balancedWith ?? null,
        )
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
    db.prepare(
      'INSERT INTO settings (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data',
    ).run(data)
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
}
