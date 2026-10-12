import type {
  ProgressEvent,
  Settings,
  SyncOpKind,
  TimeEntry,
} from '../types'

// ---------------------------------------------------------------------------
// Endpoint identity
// ---------------------------------------------------------------------------
// endpointId is client-only provenance stamped on every queued operation. It
// is derived deterministically from the backend mode + normalized URL so a
// queue entry can never be replayed against a different server. It is never
// sent in a request body and never contains credentials beyond what the URL
// itself carries (a URL with embedded credentials is rejected by
// validateBackendUrl before it can become an endpoint).

export function normalizeEndpointUrl(raw: string, origin: string): string {
  const trimmed = raw.trim()
  if (trimmed === '') return origin
  try {
    const url = new URL(trimmed, origin)
    const path = url.pathname.replace(/\/+$/, '')
    return `${url.protocol}//${url.host}${path}${url.search}`
  } catch {
    return trimmed
  }
}

export function endpointIdFor(mode: string, backendUrl: string, origin: string): string | null {
  if (mode !== 'sqlite') return null
  return `sqlite:${normalizeEndpointUrl(backendUrl, origin)}`
}

export function validateBackendUrl(raw: string, pageProtocol: string): string | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null // same-origin deployment
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return 'Enter a full URL like http://localhost:3000 (or leave empty for same-origin).'
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return 'Only http:// or https:// backend URLs are supported.'
  }
  if (url.username !== '' || url.password !== '') {
    return 'Do not put credentials in the URL. Put the server behind an authenticated private access layer instead.'
  }
  if (pageProtocol === 'https:' && url.protocol === 'http:') {
    return 'This page is served over HTTPS, so an http:// backend is blocked by the browser. Serve the backend over HTTPS.'
  }
  return null
}

// ---------------------------------------------------------------------------
// Portable preferences
// ---------------------------------------------------------------------------
// Only these settings travel between devices. Backend URL/mode, theme,
// notification permission, sound, and any credential never leave the device.

export const PORTABLE_SETTING_KEYS = [
  'weeklyAllocations',
  'activities',
  'goals',
  'onboardingCompleted',
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

export type PortablePreferences = Partial<Pick<Settings, (typeof PORTABLE_SETTING_KEYS)[number]>>

function dataClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function portablePreferencesOf(settings: Settings): PortablePreferences {
  const out: Record<string, unknown> = {}
  const source = settings as unknown as Record<string, unknown>
  for (const key of PORTABLE_SETTING_KEYS) out[key] = dataClone(source[key])
  return out as PortablePreferences
}

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

export function preferencesFingerprint(settings: Settings): string {
  return canonicalize(portablePreferencesOf(settings))
}

// ---------------------------------------------------------------------------
// Protocol wire shapes
// ---------------------------------------------------------------------------

export interface SyncSnapshotEntry {
  entry: TimeEntry
  revision: number
}

export interface SyncSnapshotEvent {
  event: ProgressEvent
  revision: number
}

export interface SyncTombstoneInfo {
  id: string
  revision: number
  deletedAt: number
}

export interface SyncSnapshot {
  protocol: 1
  entries: SyncSnapshotEntry[]
  entryTombstones: SyncTombstoneInfo[]
  preferences: { value: PortablePreferences; revision: number } | null
  progressEvents: SyncSnapshotEvent[]
  eventTombstones: SyncTombstoneInfo[]
}

export type SyncRemoteState =
  | { kind: 'entry'; entry: TimeEntry; revision: number }
  | { kind: 'tombstone'; tombstone: SyncTombstoneInfo }
  | { kind: 'preferences'; value: PortablePreferences; revision: number }
  | { kind: 'missing'; revision: number | null }

export interface SyncOperationAck {
  operationId: string
  replay: boolean
  status: 'applied' | 'conflict' | 'rejected'
  resource: string | null
  revision?: number
  tombstoned?: boolean
  remote?: SyncRemoteState
  reason?: string
}

// ---------------------------------------------------------------------------
// Resource addressing
// ---------------------------------------------------------------------------

export function resourceOf(kind: SyncOpKind, payload: unknown): string | null {
  if (kind === 'preferences-replace') return 'preferences'
  const id = payloadId(payload)
  if (id === null) return null
  if (kind === 'event-upsert' || kind === 'event-delete') return `event:${id}`
  return `entry:${id}`
}

function payloadId(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null
  const id = (payload as Record<string, unknown>).id
  return typeof id === 'string' && id.length > 0 ? id : null
}

// ---------------------------------------------------------------------------
// Snapshot merge
// ---------------------------------------------------------------------------
// Deterministic bootstrap: remote rows merge into local state while pending
// local intent is always preserved. Anything that cannot be reconciled
// automatically becomes a surfaced conflict with both copies kept.

export interface SnapshotEntryConflict {
  entryId: string
  local: TimeEntry
  remote: TimeEntry | null
  remoteRevision: number | null
  reason: 'content-diverged' | 'deleted-remotely'
}

export interface SnapshotMerge {
  entries: TimeEntry[]
  conflicts: SnapshotEntryConflict[]
}

function sameEntry(a: TimeEntry, b: TimeEntry): boolean {
  return canonicalize(a) === canonicalize(b)
}

export function mergeSnapshotEntries(args: {
  localEntries: TimeEntry[]
  remoteEntries: SyncSnapshotEntry[]
  entryTombstones: SyncTombstoneInfo[]
  latestPendingKind: Map<string, 'entry-upsert' | 'entry-delete' | 'entry-restore'>
}): SnapshotMerge {
  const { localEntries, remoteEntries, entryTombstones, latestPendingKind } = args
  const conflicts: SnapshotEntryConflict[] = []
  const remoteById = new Map(remoteEntries.map(({ entry, revision }) => [entry.id, { entry, revision }]))
  const tombstoneById = new Map(entryTombstones.map((t) => [t.id, t]))
  const kept = new Map<string, TimeEntry>()

  for (const local of localEntries) {
    const tomb = tombstoneById.get(local.id)
    if (tomb) {
      const pending = latestPendingKind.get(local.id)
      if (pending === 'entry-delete' || pending === undefined) {
        // Both sides agree the entry is gone — apply the tombstone.
        continue
      }
      // Locally re-edited or restored while remotely deleted: real conflict.
      conflicts.push({
        entryId: local.id,
        local: { ...local },
        remote: null,
        remoteRevision: tomb.revision,
        reason: 'deleted-remotely',
      })
      kept.set(local.id, local)
      continue
    }
    const remote = remoteById.get(local.id)
    if (!remote) {
      kept.set(local.id, local)
      continue
    }
    if (sameEntry(local, remote.entry)) {
      kept.set(local.id, local)
      continue
    }
    // Divergent content: preserve the local copy and surface both versions.
    conflicts.push({
      entryId: local.id,
      local: { ...local },
      remote: { ...remote.entry },
      remoteRevision: remote.revision,
      reason: 'content-diverged',
    })
    kept.set(local.id, local)
  }

  for (const { entry } of remoteEntries) {
    if (kept.has(entry.id) || tombstoneById.has(entry.id)) continue
    if (localEntries.some((e) => e.id === entry.id)) continue
    kept.set(entry.id, { ...entry })
  }

  const entries = [...kept.values()].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id))
  return { entries, conflicts }
}
