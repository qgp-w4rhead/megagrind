import { computed, onScopeDispose, reactive, watch, type ComputedRef } from 'vue'
import { STORAGE_KEY } from '../domain/backup'

export type TabMessageKind = 'hello' | 'announce' | 'bye' | 'domain-changed'

export interface TabMessage {
  kind: TabMessageKind
  tabId: string
  startedAt: number
}

export interface TabChannel {
  postMessage(message: TabMessage): void
  onmessage: ((event: { data: TabMessage }) => void) | null
  close(): void
}

interface CoordinationStore {
  lastSavedPayload: string
  $hydrate: () => void
}

export interface TabCoordinationOptions {
  makeChannel?: () => TabChannel | null
  heartbeatMs?: number
  staleMs?: number
}

function makeTabId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`
}

// Coordinates tabs that share the same persisted store: heartbeats elect one
// scheduler leader (avoids duplicate notifications), and a 'domain-changed'
// broadcast — or the storage event fallback — tells other tabs to rehydrate.
export function useTabCoordination(store: CoordinationStore, options?: TabCoordinationOptions) {
  const tabId = makeTabId()
  const startedAt = Date.now()
  const heartbeatMs = options?.heartbeatMs ?? 5000
  const staleMs = options?.staleMs ?? heartbeatMs * 3
  const peers = reactive(new Map<string, { startedAt: number; lastSeen: number }>())

  let channel: TabChannel | null = null
  if (options?.makeChannel) {
    channel = options.makeChannel()
  } else if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel('megagrind-tabs') as unknown as TabChannel
  }

  function post(kind: TabMessageKind) {
    channel?.postMessage({ kind, tabId, startedAt })
  }

  let hydrateTimer: ReturnType<typeof setTimeout> | null = null
  let applyingRemote = false
  function scheduleHydrate() {
    if (hydrateTimer !== null) return
    hydrateTimer = setTimeout(() => {
      hydrateTimer = null
      applyingRemote = true
      try {
        store.$hydrate()
      } finally {
        setTimeout(() => {
          applyingRemote = false
        }, 0)
      }
    }, 50)
  }

  function handle(message: TabMessage) {
    if (!message || typeof message !== 'object' || message.tabId === tabId) return
    if (message.kind === 'bye') {
      peers.delete(message.tabId)
      return
    }
    peers.set(message.tabId, { startedAt: message.startedAt, lastSeen: Date.now() })
    if (message.kind === 'hello') post('announce')
    else if (message.kind === 'domain-changed') scheduleHydrate()
  }

  if (channel) channel.onmessage = (event) => handle(event.data)

  const heartbeat = setInterval(() => {
    const cutoff = Date.now() - staleMs
    for (const [id, peer] of peers) {
      if (peer.lastSeen < cutoff) peers.delete(id)
    }
    post('announce')
  }, heartbeatMs)

  // The persistence write itself fires a cross-tab 'storage' event, so when
  // BroadcastChannel is unavailable the same notification is still delivered.
  function onStorage(event: StorageEvent) {
    if (event.key === STORAGE_KEY) scheduleHydrate()
  }
  const usingStorageFallback = channel === null && typeof window !== 'undefined'
  if (usingStorageFallback) window.addEventListener('storage', onStorage)

  function onPageHide() {
    post('bye')
  }
  if (typeof window !== 'undefined') window.addEventListener('pagehide', onPageHide)

  // Only a durable write changes lastSavedPayload; hydration keeps it equal,
  // so this broadcasts real local mutations exactly once without echo loops.
  const stopPayloadWatch = watch(
    () => store.lastSavedPayload,
    () => {
      if (!applyingRemote) post('domain-changed')
    },
  )

  post('hello')

  const isLeader: ComputedRef<boolean> = computed(() => {
    for (const [id, peer] of peers) {
      if (peer.startedAt < startedAt) return false
      if (peer.startedAt === startedAt && id < tabId) return false
    }
    return true
  })

  onScopeDispose(() => {
    stopPayloadWatch()
    clearInterval(heartbeat)
    if (hydrateTimer !== null) clearTimeout(hydrateTimer)
    post('bye')
    channel?.close()
    if (usingStorageFallback) window.removeEventListener('storage', onStorage)
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', onPageHide)
  })

  return { tabId, isLeader }
}
