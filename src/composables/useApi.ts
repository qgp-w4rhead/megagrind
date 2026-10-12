import { ref } from 'vue'
import type { TimeEntry, Settings, SyncOpKind } from '../types'
import type { SyncOperationAck, SyncSnapshot } from '../domain/sync'

export type BackendMode = 'local' | 'sqlite' | 'mongodb'
export type DatabaseType = 'sqlite'

export interface DbStatus {
  active: DatabaseType | null
  available: DatabaseType[]
}

// Carries the sanitized server response for non-2xx replies so the sync layer
// can distinguish retryable failures from validation/conflict outcomes
// without ever surfacing raw server internals.
export class ApiError extends Error {
  readonly status: number
  readonly body: { error?: string } & Record<string, unknown>
  constructor(status: number, body: { error?: string } & Record<string, unknown>) {
    super(body.error || `HTTP ${status}`)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

// Backend config lives in the megagrind store (persisted under 'megagrind-store').
// These refs are set by the store via setBaseUrl/setBackendMode — no separate
// localStorage keys, so there is a single source of truth.
const baseUrl = ref('')
const backendMode = ref<BackendMode>('local')
const isBackendAvailable = ref(false)

function setBaseUrl(url: string) {
  baseUrl.value = url
}

function setBackendMode(mode: BackendMode) {
  backendMode.value = mode
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  timeoutMs = 10000,
  base: string = baseUrl.value,
): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${base}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      signal: controller.signal,
    })

    if (!res.ok) {
      const body = (await res.json().catch(() => ({ error: res.statusText }))) as {
        error?: string
      } & Record<string, unknown>
      throw new ApiError(res.status, body)
    }

    return res.json() as Promise<T>
  } finally {
    clearTimeout(timer)
  }
}

async function checkConnection(candidateUrl?: string): Promise<boolean> {
  if (candidateUrl !== undefined) {
    try {
      await request<{ status: string }>('/api/health', {}, 10000, candidateUrl)
      return true
    } catch {
      return false
    }
  }
  try {
    await request<{ status: string }>('/api/health')
    isBackendAvailable.value = true
    return true
  } catch {
    isBackendAvailable.value = false
    return false
  }
}

async function getDbStatus(candidateUrl?: string): Promise<DbStatus> {
  return request<DbStatus>('/api/db/status', {}, 10000, candidateUrl ?? baseUrl.value)
}

async function switchDatabase(type: DatabaseType): Promise<DbStatus> {
  return request<DbStatus>('/api/db/switch', {
    method: 'POST',
    body: JSON.stringify({ type }),
  })
}

async function getEntries(weekStart?: number): Promise<TimeEntry[]> {
  const query = weekStart !== undefined ? `?weekStart=${encodeURIComponent(weekStart)}` : ''
  return request<TimeEntry[]>(`/api/entries${query}`)
}

async function createEntry(entry: TimeEntry): Promise<TimeEntry> {
  return request<TimeEntry>('/api/entries', {
    method: 'POST',
    body: JSON.stringify(entry),
  })
}

async function updateEntry(id: string, updates: Partial<Omit<TimeEntry, 'id'>>): Promise<TimeEntry> {
  return request<TimeEntry>(`/api/entries/${id}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  })
}

async function deleteEntry(id: string): Promise<void> {
  await request<{ success: boolean }>(`/api/entries/${id}`, {
    method: 'DELETE',
  })
}

async function getSettings(): Promise<Settings | null> {
  return request<Settings | null>('/api/settings')
}

async function updateSettings(settings: Settings): Promise<Settings> {
  return request<Settings>('/api/settings', {
    method: 'PUT',
    body: JSON.stringify(settings),
  })
}

async function bulkUpsertEntries(entries: TimeEntry[]): Promise<void> {
  await request<{ success: boolean; count: number }>('/api/entries/bulk', {
    method: 'POST',
    body: JSON.stringify(entries),
  })
}

async function getState<T = unknown>(key: string): Promise<T | null> {
  return request<T | null>(`/api/state/${encodeURIComponent(key)}`)
}

async function putState(key: string, value: unknown): Promise<void> {
  await request<{ success: boolean }>(`/api/state/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify(value),
  })
}

async function getSyncSnapshot(): Promise<SyncSnapshot> {
  return request<SyncSnapshot>('/api/sync/snapshot')
}

async function postSyncOperation(op: {
  operationId: string
  kind: SyncOpKind
  baseRevision: number | null
  payload: unknown
}): Promise<SyncOperationAck> {
  return request<SyncOperationAck>('/api/sync/operations', {
    method: 'POST',
    body: JSON.stringify(op),
  })
}

export function useApi() {
  return {
    baseUrl,
    backendMode,
    isBackendAvailable,
    setBaseUrl,
    setBackendMode,
    checkConnection,
    getDbStatus,
    switchDatabase,
    getEntries,
    createEntry,
    updateEntry,
    deleteEntry,
    getSettings,
    updateSettings,
    bulkUpsertEntries,
    getState,
    putState,
    getSyncSnapshot,
    postSyncOperation,
  }
}
