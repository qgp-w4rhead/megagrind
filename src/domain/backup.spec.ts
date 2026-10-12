import { describe, it, expect } from 'vitest'
import {
  applyImport,
  decodeImportDocument,
  makeFullBackup,
  makePeriodReport,
  previewImport,
} from './backup'
import { DEFAULT_SETTINGS } from '../types'
import type { ProgressEvent, TimeEntry } from '../types'

const T = (s: string) => Date.parse(s)
const now = T('2026-10-11T18:30:00Z')

function entries(): TimeEntry[] {
  return [
    { id: 'open', type: 'work', start: T('2026-10-11T17:00:00Z'), end: null, description: 'live' },
    { id: 'night', type: 'sleep', start: T('2026-10-10T23:00:00Z'), end: T('2026-10-11T01:00:00Z') },
    { id: 'adj', type: 'work', start: T('2026-10-11T12:00:00Z'), end: T('2026-10-11T11:00:00Z'), isCorrection: true, balancedWith: 'pair' },
  ]
}

function events(): ProgressEvent[] {
  return [{ id: 'event-1', sessionId: 'open', at: now - 1000, outcome: 'progress' }]
}

function backup(settings = DEFAULT_SETTINGS) {
  return makeFullBackup({ exportedAt: now, entries: entries(), settings, progressEvents: events(), progressHistoryStartedAt: now - 10_000 })
}

describe('portable backup documents', () => {
  it('a full backup includes all unsynced/open/signed/custom records and only portable preferences', () => {
    const b = backup({ ...DEFAULT_SETTINGS, backendMode: 'sqlite', backendUrl: 'http://private.test', darkMode: 'light', notificationsEnabled: false })
    expect(b.entries).toEqual(entries())
    expect(b.progressEvents).toEqual(events())
    expect(b.preferences).not.toHaveProperty('backendMode')
    expect(b.preferences).not.toHaveProperty('backendUrl')
    expect(b.preferences).not.toHaveProperty('darkMode')
    expect(b.preferences).not.toHaveProperty('notificationsEnabled')
    const decoded = decodeImportDocument(JSON.stringify(b))
    expect(decoded.kind).toBe('full')
    if (decoded.kind === 'full') expect(decoded.backup).toEqual(b)
  })

  it('a malformed file, unknown version and read-only period report are rejected before mutation', () => {
    expect(() => decodeImportDocument('not json')).toThrow('valid JSON')
    expect(() => decodeImportDocument(JSON.stringify({ version: 99, entries: [] }))).toThrow('version')
    const report = makePeriodReport({ exportedAt: now, now, range: { start: T('2026-10-10T23:00:00Z'), end: T('2026-10-11T01:00:00Z') }, entries: entries() })
    expect(() => decodeImportDocument(JSON.stringify(report))).toThrow('period report')
  })

  it('a 23:00->01:00 report writes one projected interval with the original entry id while the full backup keeps raw timestamps', () => {
    const range = { start: T('2026-10-10T23:00:00Z'), end: T('2026-10-11T01:00:00Z') }
    const report = makePeriodReport({ exportedAt: now, now, range, entries: [entries()[1]!] })
    expect(report.intervals).toEqual([
      { entryId: 'night', type: 'sleep', start: range.start, end: range.end, duration: 7_200_000, isAdjustment: false, isRunning: false },
    ])
    expect(backup().entries.find((e) => e.id === 'night')).toEqual(entries()[1])
  })
})

describe('import preview and apply', () => {
  it('merge preview classifies additions, identical records and changed same-id conflicts; cancel leaves inputs untouched', () => {
    const local = entries()
    const imported = backup()
    imported.entries[0] = { ...imported.entries[0]!, description: 'incoming' }
    imported.entries.push({ id: 'new', type: 'reading', start: now - 1000, end: now })
    const before = JSON.stringify(local)
    const preview = previewImport({ imported, localEntries: local, localEvents: [], mode: 'merge', now })
    expect(preview.added).toEqual(['new'])
    expect(preview.identical).toEqual(['night', 'adj'])
    expect(preview.conflicts).toEqual(['open'])
    expect(JSON.stringify(local)).toBe(before)
  })

  it('same-id conflicts apply only after explicit choices; file/local choices produce the requested records', () => {
    const local = entries()
    const imported = backup()
    imported.entries[0] = { ...imported.entries[0]!, description: 'incoming' }
    const blocked = applyImport({ imported, localEntries: local, localSettings: DEFAULT_SETTINGS, localEvents: [], localHistoryStartedAt: null, options: { mode: 'merge' }, now })
    expect(blocked.kind).toBe('blocked')
    const result = applyImport({ imported, localEntries: local, localSettings: DEFAULT_SETTINGS, localEvents: [], localHistoryStartedAt: null, options: { mode: 'merge', conflictChoices: { open: 'imported' } }, now })
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') expect(result.entries.find((e) => e.id === 'open')?.description).toBe('incoming')
  })

  it('a second open record is blocked until the user chooses which stays open and gives a valid finish time', () => {
    const local = [{ id: 'local-open', type: 'move', start: now - 2000, end: null }]
    const imported = backup()
    const blocked = applyImport({ imported, localEntries: local, localSettings: DEFAULT_SETTINGS, localEvents: [], localHistoryStartedAt: null, options: { mode: 'merge' }, now })
    expect(blocked).toMatchObject({ kind: 'blocked', needs: 'open' })
    const resolved = applyImport({
      imported,
      localEntries: local,
      localSettings: DEFAULT_SETTINGS,
      localEvents: [],
      localHistoryStartedAt: null,
      options: { mode: 'merge', openChoice: { keepEntryId: 'open', close: { 'local-open': now - 1000 } } },
      now,
    })
    expect(resolved.kind).toBe('ok')
    if (resolved.kind === 'ok') {
      expect(resolved.entries.filter((e) => e.end === null).map((e) => e.id)).toEqual(['open'])
      expect(resolved.entries.find((e) => e.id === 'local-open')?.end).toBe(now - 1000)
    }
  })

  it('portable preference restore is optional and never changes device URL, mode, theme, or alerts', () => {
    const imported = backup({ ...DEFAULT_SETTINGS, focusModeDuration: 120, progressCheckEnabled: false })
    const localSettings = { ...DEFAULT_SETTINGS, backendMode: 'sqlite' as const, backendUrl: 'http://private.test', darkMode: 'light' as const, notificationsEnabled: false }
    const off = applyImport({ imported, localEntries: [], localSettings, localEvents: [], localHistoryStartedAt: null, options: { mode: 'merge', restorePreferences: false }, now })
    const on = applyImport({ imported, localEntries: [], localSettings, localEvents: [], localHistoryStartedAt: null, options: { mode: 'merge', restorePreferences: true }, now })
    expect(off.kind).toBe('ok')
    expect(on.kind).toBe('ok')
    if (off.kind === 'ok') expect(off.settingsPatch).toBeNull()
    if (on.kind === 'ok') {
      expect(on.settingsPatch?.focusModeDuration).toBe(120)
      expect(on.settingsPatch?.progressCheckEnabled).toBe(false)
      expect(on.settingsPatch).not.toHaveProperty('backendMode')
      expect(on.settingsPatch).not.toHaveProperty('backendUrl')
      expect(on.settingsPatch).not.toHaveProperty('darkMode')
      expect(on.settingsPatch).not.toHaveProperty('notificationsEnabled')
    }
  })

  it('a full backup restores into an empty store with the same logical records', () => {
    const b = backup()
    const result = applyImport({
      imported: b,
      localEntries: [],
      localSettings: DEFAULT_SETTINGS,
      localEvents: [],
      localHistoryStartedAt: null,
      options: { mode: 'replace', restorePreferences: true, eventMode: 'replace' },
      now,
    })
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') {
      const byStart = (a: TimeEntry, c: TimeEntry) => a.start - c.start || a.id.localeCompare(c.id)
      expect([...result.entries].sort(byStart)).toEqual([...b.entries].sort(byStart))
      expect(result.progressEvents).toEqual(b.progressEvents)
      expect(result.progressHistoryStartedAt).toBe(b.progressHistoryStartedAt)
      expect(result.settingsPatch).toEqual(b.preferences)
    }
  })

  it('progress events merge immutably by id and preserve the earliest declared history start', () => {
    const localEvent = { id: 'local-event', sessionId: 's', at: now - 5000, outcome: 'blocked' as const }
    const result = applyImport({
      imported: backup(),
      localEntries: [],
      localSettings: DEFAULT_SETTINGS,
      localEvents: [localEvent],
      localHistoryStartedAt: now - 4000,
      options: { mode: 'merge', eventMode: 'merge' },
      now,
    })
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') {
      expect(result.progressEvents.map((e) => e.id)).toEqual(['local-event', 'event-1'])
      expect(result.progressHistoryStartedAt).toBe(now - 10_000)
    }
  })
})
