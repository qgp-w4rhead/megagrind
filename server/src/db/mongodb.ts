import { MongoClient, type Collection } from 'mongodb'
import type {
  DatabaseAdapter,
  DatabaseType,
  Settings,
  TimeEntry,
  WeekData,
} from './types.js'

export class MongoDBDatabaseAdapter implements DatabaseAdapter {
  readonly type: DatabaseType = 'mongodb'
  private client: MongoClient | null = null
  private entriesCol: Collection<TimeEntry> | null = null
  private settingsCol: Collection<{ _id: string; data: Settings }> | null = null
  private weeksCol: Collection<{ weekStart: number; data: WeekData }> | null = null
  private uri: string
  private dbName: string

  constructor(uri: string, dbName: string) {
    this.uri = uri
    this.dbName = dbName
  }

  async connect(): Promise<void> {
    this.client = new MongoClient(this.uri)
    await this.client.connect()
    const db = this.client.db(this.dbName)

    this.entriesCol = db.collection<TimeEntry>('entries')
    this.settingsCol = db.collection<{ _id: string; data: Settings }>('settings')
    this.weeksCol = db.collection<{ weekStart: number; data: WeekData }>('weeks')

    await this.entriesCol.createIndex({ start: 1 })
    await this.weeksCol.createIndex({ weekStart: 1 }, { unique: true })
  }

  async disconnect(): Promise<void> {
    await this.client?.close()
    this.client = null
    this.entriesCol = null
    this.settingsCol = null
    this.weeksCol = null
  }

  private getEntriesCol(): Collection<TimeEntry> {
    if (!this.entriesCol) throw new Error('MongoDB adapter not connected')
    return this.entriesCol
  }

  private getSettingsCol(): Collection<{ _id: string; data: Settings }> {
    if (!this.settingsCol) throw new Error('MongoDB adapter not connected')
    return this.settingsCol
  }

  private getWeeksCol(): Collection<{ weekStart: number; data: WeekData }> {
    if (!this.weeksCol) throw new Error('MongoDB adapter not connected')
    return this.weeksCol
  }

  async getEntries(weekStart?: number): Promise<TimeEntry[]> {
    const col = this.getEntriesCol()
    const filter: Record<string, unknown> = {}
    if (weekStart !== undefined) {
      const weekEnd = weekStart + 7 * 24 * 60 * 60 * 1000
      filter.start = { $gte: weekStart, $lt: weekEnd }
    }
    const docs = await col.find(filter).sort({ start: 1 }).toArray()
    return docs.map(({ _id, ...entry }) => entry as TimeEntry)
  }

  async getEntry(id: string): Promise<TimeEntry | null> {
    const col = this.getEntriesCol()
    const doc = await col.findOne({ id } as unknown as Record<string, unknown>)
    if (!doc) return null
    const { _id, ...entry } = doc as unknown as { _id: unknown } & TimeEntry
    return entry as TimeEntry
  }

  async createEntry(entry: TimeEntry): Promise<TimeEntry> {
    const col = this.getEntriesCol()
    await col.insertOne(entry as unknown as Record<string, unknown> as never)
    return entry
  }

  async updateEntry(id: string, updates: Partial<Omit<TimeEntry, 'id'>>): Promise<TimeEntry> {
    const col = this.getEntriesCol()
    const result = await col.findOneAndUpdate(
      { id } as unknown as Record<string, unknown>,
      { $set: updates } as unknown as Record<string, unknown>,
      { returnDocument: 'after' },
    )
    if (!result) throw new Error(`Entry ${id} not found`)
    const { _id, ...entry } = result as unknown as { _id: unknown } & TimeEntry
    return entry as TimeEntry
  }

  async deleteEntry(id: string): Promise<void> {
    const col = this.getEntriesCol()
    await col.deleteOne({ id } as unknown as Record<string, unknown>)
  }

  async getSettings(): Promise<Settings | null> {
    const col = this.getSettingsCol()
    const doc = await col.findOne({ _id: 'default' })
    if (!doc) return null
    return doc.data
  }

  async updateSettings(settings: Settings): Promise<Settings> {
    const col = this.getSettingsCol()
    await col.updateOne({ _id: 'default' }, { $set: { data: settings } }, { upsert: true })
    return settings
  }

  async getWeeks(): Promise<WeekData[]> {
    const col = this.getWeeksCol()
    const docs = await col.find({}).sort({ weekStart: -1 }).toArray()
    return docs.map((d) => d.data)
  }

  async getWeek(weekStart: number): Promise<WeekData | null> {
    const col = this.getWeeksCol()
    const doc = await col.findOne({ weekStart })
    if (!doc) return null
    return doc.data
  }

  async saveWeek(data: WeekData): Promise<WeekData> {
    const col = this.getWeeksCol()
    await col.updateOne(
      { weekStart: data.weekStart },
      { $set: { weekStart: data.weekStart, data } },
      { upsert: true },
    )
    return data
  }
}
