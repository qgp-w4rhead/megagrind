import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useMegagrindStore } from './megagrind'
import { useApi } from '../composables/useApi'
import { DEFAULT_SETTINGS, createDefaultSettings } from '../types'

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: 'ok' }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('default connection contract', () => {
  it('fresh installs are local with a same-origin empty endpoint', () => {
    expect(DEFAULT_SETTINGS.backendMode).toBe('local')
    expect(DEFAULT_SETTINGS.backendUrl).toBe('')
    expect(createDefaultSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('a fresh local store performs no network request on startup', async () => {
    const store = useMegagrindStore()
    await store.initFromBackend()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(store.settings.backendMode).toBe('local')
  })

  it('existing explicit modes and URLs are preserved on migration', () => {
    const store = useMegagrindStore()
    store.settings.backendMode = 'sqlite'
    store.settings.backendUrl = 'http://example.test:3000'
    store.migrateSettings()
    expect(store.settings.backendMode).toBe('sqlite')
    expect(store.settings.backendUrl).toBe('http://example.test:3000')
  })

  it('settings missing the connection keys default to local with a same-origin endpoint', () => {
    const store = useMegagrindStore()
    Reflect.deleteProperty(store.settings, 'backendMode')
    Reflect.deleteProperty(store.settings, 'backendUrl')
    store.migrateSettings()
    expect(store.settings.backendMode).toBe('local')
    expect(store.settings.backendUrl).toBe('')
  })

  it('only an explicit sqlite mode starts sync; unknown modes make no requests and keep queued writes', async () => {
    const store = useMegagrindStore()
    store.settings.backendMode = 'mongodb'
    store.entries.push({ id: 'q', type: 'work', start: 1, end: 2 })
    store.syncQueue.push({
      operationId: 'legacy-op',
      endpointId: 'sqlite:http://elsewhere.test',
      kind: 'entry-delete',
      payload: { id: 'old' },
      baseRevision: null,
      status: 'pending',
      blockedReason: null,
      attempts: 0,
    })
    await store.initFromBackend()
    store.deleteEntry('q')
    await store.flushSyncQueue()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(store.syncQueue.length).toBeGreaterThanOrEqual(1)
    expect(store.settings.backendMode).toBe('mongodb')
  })
})

describe('candidate connection checks', () => {
  it('checks an explicit candidate URL without changing the active endpoint', async () => {
    const api = useApi()
    api.setBaseUrl('')
    api.isBackendAvailable.value = false
    const ok = await api.checkConnection('http://candidate.test')
    expect(ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith('http://candidate.test/api/health', expect.anything())
    expect(api.baseUrl.value).toBe('')
    expect(api.isBackendAvailable.value).toBe(false)
  })

  it('reads database status from a candidate URL without changing the active endpoint', async () => {
    const api = useApi()
    api.setBaseUrl('')
    await api.getDbStatus('http://candidate.test')
    expect(fetchMock).toHaveBeenCalledWith('http://candidate.test/api/db/status', expect.anything())
    expect(api.baseUrl.value).toBe('')
  })
})
