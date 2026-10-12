import { reactive, readonly } from 'vue'

// PWA capability + lifecycle state. Kept framework-thin so it can be exercised
// in specs: init() wires real browser events once; the reactive state is the
// single read surface for components.

export type InstallCapability =
  | 'installable' // beforeinstallprompt captured — a real install action exists
  | 'installed' // already running standalone
  | 'ios-manual' // iOS Safari — Add to Home Screen is manual
  | 'unsupported' // no install surface, but the app still works
  | 'insecure' // not a secure context — install is unavailable by design

export interface PwaState {
  capability: InstallCapability
  updateReady: boolean
  offlineLaunch: boolean
}

export const pwaState = reactive<PwaState>({
  capability: 'unsupported',
  updateReady: false,
  offlineLaunch: typeof navigator !== 'undefined' ? !navigator.onLine : false,
})

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferredPrompt: BeforeInstallPromptEvent | null = null
let waitingWorker: ServiceWorker | null = null
let refreshRequested = false
let wired = false

function isStandaloneMode(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

function detectIos(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  return /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

function watchForWaiting(reg: ServiceWorkerRegistration) {
  const track = (worker: ServiceWorker | null) => {
    if (worker && worker.state === 'installed') {
      waitingWorker = worker
      pwaState.updateReady = true
    }
  }
  if (reg.waiting) track(reg.waiting)
  reg.addEventListener('updatefound', () => {
    const next = reg.installing
    next?.addEventListener('statechange', () => {
      if (next.state === 'installed' && navigator.serviceWorker.controller) {
        waitingWorker = next
        pwaState.updateReady = true
      }
    })
  })
}

export function initPwa() {
  if (wired || typeof window === 'undefined') return
  wired = true
  const secure = window.isSecureContext !== false
  if (isStandaloneMode()) pwaState.capability = 'installed'
  else if (!secure) pwaState.capability = 'insecure'
  else if (detectIos()) pwaState.capability = 'ios-manual'

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    deferredPrompt = event as BeforeInstallPromptEvent
    if (pwaState.capability !== 'installed' && pwaState.capability !== 'insecure') {
      pwaState.capability = 'installable'
    }
  })
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    pwaState.capability = 'installed'
  })
  window.addEventListener('online', () => { pwaState.offlineLaunch = false })
  window.addEventListener('offline', () => { pwaState.offlineLaunch = true })

  if ('serviceWorker' in navigator && secure) {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => watchForWaiting(reg))
      .catch(() => { /* SW unavailable (private mode, headless) — app still works */ })
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshRequested) window.location.reload()
    })
  }
}

export function canInstall(): boolean {
  return pwaState.capability === 'installable' && deferredPrompt !== null
}

export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferredPrompt) return 'unavailable'
  await deferredPrompt.prompt()
  const choice = await deferredPrompt.userChoice
  deferredPrompt = null
  if (choice.outcome === 'accepted') pwaState.capability = 'installed'
  return choice.outcome
}

// The caller decides whether reload is safe; this only releases the waiting
// worker and reloads once it takes control.
export function applyUpdate(): boolean {
  if (!waitingWorker) return false
  refreshRequested = true
  waitingWorker.postMessage({ type: 'SKIP_WAITING' })
  return true
}

export const pwa = readonly(pwaState)

// Test hook: clears module wiring so each spec starts from a clean state.
export function resetPwaForTests() {
  wired = false
  deferredPrompt = null
  waitingWorker = null
  refreshRequested = false
  pwaState.capability = 'unsupported'
  pwaState.updateReady = false
  pwaState.offlineLaunch = false
}
