import { ref } from 'vue'
import type { TimeEntry, Settings, WeekData } from '../types'

export type BackendMode = 'local' | 'sqlite' | 'mongodb'
export type DatabaseType = 'sqlite' | 'mongodb'

export interface DbStatus {
  active: DatabaseType | null
  available: DatabaseType[]
}

function getBaseUrl(): string {
  try {
    const stored = localStorage.getItem('megagrind-backend-url')
    if (stored) return stored
  } catch {
    // ignore
  }
  return 'http://localhost:3000'
}

function getBackendMode(): BackendMode {
  try {
    const stored = localStorage.getItem('megagrind-backend-mode')
    if (stored === 'sqlite' || stored === 'mongodb') return stored
  } catch {
    // ignore
  }
  return 'local'
}

const baseUrl = ref(getBaseUrl())
const backendMode = ref<BackendMode>(getBackendMode())
const isBackendAvailable = ref(false)

function setBaseUrl(url: string) {
  baseUrl.value = url
  try {
    localStorage.setItem('megagrind-backend-url', url)
  } catch {
    // ignore
  }
}

function setBackendMode(mode: BackendMode) {
  backendMode.value = mode
  try {
    localStorage.setItem('megagrind-backend-mode', mode)
  } catch {
    // ignore
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${baseUrl.value}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(body.error || `HTTP ${res.status}`)
  }

  return res.json() as Promise<T>
}

async function checkConnection(): Promise<boolean> {
  try {
    await request<{ status: string }>('/api/health')
    isBackendAvailable.value = true
    return true
  } catch {
    isBackendAvailable.value = false
    return false
  }
}

async function getDbStatus(): Promise<DbStatus> {
  return request<DbStatus>('/api/db/status')
}

async function switchDatabase(type: DatabaseType): Promise<DbStatus> {
  return request<DbStatus>('/api/db/switch', {
    method: 'POST',
    body: JSON.stringify({ type }),
  })
}

async function getEntries(weekStart?: number): Promise<TimeEntry[]> {
  const query = weekStart !== undefined ? `?weekStart=${weekStart}` : ''
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

async function getWeeks(): Promise<WeekData[]> {
  return request<WeekData[]>('/api/weeks')
}

async function getWeek(weekStart: number): Promise<WeekData | null> {
  return request<WeekData | null>(`/api/weeks/${weekStart}`)
}

async function saveWeek(data: WeekData): Promise<WeekData> {
  return request<WeekData>('/api/weeks', {
    method: 'POST',
    body: JSON.stringify(data),
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
    getWeeks,
    getWeek,
    saveWeek,
  }
}
