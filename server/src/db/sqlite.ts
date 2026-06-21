import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type {
  DatabaseAdapter,
  DatabaseType,
  Settings,
  TimeEntry,
  WeekData,
} from './types.js'

interface EntryRow {
  id: string
  type: string
  start: number
  end: number | null
  category: string | null
  description: string | null
}

interface SettingsRow {
  data: string
}

interface WeekRow {
  week_start: number
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
        description TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_entries_start ON entries(start);

      CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY DEFAULT 1,
        data TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS weeks (
        week_start INTEGER PRIMARY KEY,
        data TEXT NOT NULL
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
      'INSERT INTO entries (id, type, start, end, category, description) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(
      entry.id,
      entry.type,
      entry.start,
      entry.end,
      entry.category ?? null,
      entry.description ?? null,
    )
    return entry
  }

  async updateEntry(id: string, updates: Partial<Omit<TimeEntry, 'id'>>): Promise<TimeEntry> {
    const db = this.getDB()
    const existing = await this.getEntry(id)
    if (!existing) throw new Error(`Entry ${id} not found`)

    const merged: TimeEntry = { ...existing, ...updates }
    db.prepare(
      'UPDATE entries SET type = ?, start = ?, end = ?, category = ?, description = ? WHERE id = ?',
    ).run(
      merged.type,
      merged.start,
      merged.end,
      merged.category ?? null,
      merged.description ?? null,
      id,
    )
    return merged
  }

  async deleteEntry(id: string): Promise<void> {
    const db = this.getDB()
    db.prepare('DELETE FROM entries WHERE id = ?').run(id)
  }

  async getSettings(): Promise<Settings | null> {
    const db = this.getDB()
    const row = db.prepare('SELECT data FROM settings WHERE id = 1').get() as
      | SettingsRow
      | undefined
    if (!row) return null
    return JSON.parse(row.data) as Settings
  }

  async updateSettings(settings: Settings): Promise<Settings> {
    const db = this.getDB()
    const data = JSON.stringify(settings)
    db.prepare(
      'INSERT INTO settings (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data',
    ).run(data)
    return settings
  }

  async getWeeks(): Promise<WeekData[]> {
    const db = this.getDB()
    const rows = db.prepare('SELECT * FROM weeks ORDER BY week_start DESC').all() as WeekRow[]
    return rows.map((r) => JSON.parse(r.data) as WeekData)
  }

  async getWeek(weekStart: number): Promise<WeekData | null> {
    const db = this.getDB()
    const row = db.prepare('SELECT * FROM weeks WHERE week_start = ?').get(weekStart) as
      | WeekRow
      | undefined
    if (!row) return null
    return JSON.parse(row.data) as WeekData
  }

  async saveWeek(data: WeekData): Promise<WeekData> {
    const db = this.getDB()
    const json = JSON.stringify(data)
    db.prepare(
      'INSERT INTO weeks (week_start, data) VALUES (?, ?) ON CONFLICT(week_start) DO UPDATE SET data = excluded.data',
    ).run(data.weekStart, json)
    return data
  }
}
