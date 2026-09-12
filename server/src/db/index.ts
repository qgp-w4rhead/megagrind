import 'dotenv/config'
import { SQLiteDatabaseAdapter } from './sqlite.js'
import type { DatabaseAdapter, DatabaseType } from './types.js'

const DEFAULT_SQLITE_PATH = './data/megagrind.db'

function createAdapter(type: DatabaseType): DatabaseAdapter {
  switch (type) {
    case 'sqlite': {
      const path = process.env.SQLITE_PATH || DEFAULT_SQLITE_PATH
      return new SQLiteDatabaseAdapter(path)
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
    await this.switch('sqlite')
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

  setAdapter(adapter: DatabaseAdapter): void {
    this.adapter = adapter
    this.currentType = adapter.type
  }

  getAvailableTypes(): DatabaseType[] {
    return ['sqlite']
  }
}

export const dbManager = new DatabaseManager()
