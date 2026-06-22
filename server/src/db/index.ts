import 'dotenv/config'
import { SQLiteDatabaseAdapter } from './sqlite.js'
import { MongoDBDatabaseAdapter } from './mongodb.js'
import type { DatabaseAdapter, DatabaseType } from './types.js'

const DEFAULT_SQLITE_PATH = './data/megagrind.db'
const DEFAULT_MONGODB_URI = 'mongodb://localhost:27017'
const DEFAULT_MONGODB_DB = 'megagrind'

function createAdapter(type: DatabaseType): DatabaseAdapter {
  switch (type) {
    case 'sqlite': {
      const path = process.env.SQLITE_PATH || DEFAULT_SQLITE_PATH
      return new SQLiteDatabaseAdapter(path)
    }
    case 'mongodb': {
      const uri = process.env.MONGODB_URI || DEFAULT_MONGODB_URI
      const dbName = process.env.MONGODB_DB || DEFAULT_MONGODB_DB
      return new MongoDBDatabaseAdapter(uri, dbName)
    }
    default:
      throw new Error(`Unknown database type: ${type}`)
  }
}

class DatabaseManager {
  private adapter: DatabaseAdapter | null = null
  private currentType: DatabaseType | null = null

  get type(): DatabaseType | null {
    return this.currentType
  }

  getAdapter(): DatabaseAdapter {
    if (!this.adapter) throw new Error('Database not initialized. Call init() first.')
    return this.adapter
  }

  async init(): Promise<void> {
    if (this.adapter) return
    const raw = process.env.DB_TYPE
    const type: DatabaseType = raw && this.getAvailableTypes().includes(raw as DatabaseType)
      ? (raw as DatabaseType)
      : 'sqlite'
    await this.switch(type)
  }

  async switch(type: DatabaseType): Promise<void> {
    if (this.adapter) {
      await this.adapter.disconnect()
    }
    const newAdapter = createAdapter(type)
    await newAdapter.connect()
    this.adapter = newAdapter
    this.currentType = type
    console.log(`[DatabaseManager] Switched to ${type}`)
  }

  getAvailableTypes(): DatabaseType[] {
    return ['sqlite', 'mongodb']
  }
}

export const dbManager = new DatabaseManager()
