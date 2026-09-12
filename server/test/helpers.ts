import { createApp } from '../src/app.js'
import { dbManager } from '../src/db/index.js'
import { SQLiteDatabaseAdapter } from '../src/db/sqlite.js'
import type { TimeEntry } from '../src/db/types.js'

export async function createTestApp() {
  const adapter = new SQLiteDatabaseAdapter(':memory:')
  await adapter.connect()
  dbManager.setAdapter(adapter)
  const app = createApp()
  return { app, adapter }
}

export function makeEntry(overrides: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: overrides.id ?? `entry-${Math.random().toString(36).slice(2, 10)}`,
    type: 'work',
    start: 1_700_000_000_000,
    end: 1_700_000_600_000,
    ...overrides,
  }
}
