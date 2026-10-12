import { describe, it, expect, vi, afterEach } from 'vitest'
import { applyUpdate, canInstall, initPwa, promptInstall, pwaState, resetPwaForTests } from './pwa'

afterEach(() => {
  resetPwaForTests()
  vi.unstubAllGlobals()
})

function fireInstallPrompt(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const prompt = vi.fn(async () => {})
  const event = new Event('beforeinstallprompt') as Event & {
    prompt: typeof prompt
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
    preventDefault: () => void
  }
  Object.defineProperty(event, 'prompt', { value: prompt })
  Object.defineProperty(event, 'userChoice', { value: Promise.resolve({ outcome }) })
  window.dispatchEvent(event)
  return prompt
}

function stubMatchMedia(standalone: boolean) {
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
    matches: standalone && query.includes('standalone'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    onchange: null,
    dispatchEvent: vi.fn(),
  })))
}

describe('pwa capability detection', () => {
  it('reports installed when display-mode is standalone and never shows a prompt path', () => {
    stubMatchMedia(true)
    initPwa()
    expect(pwaState.capability).toBe('installed')
    fireInstallPrompt()
    expect(pwaState.capability).toBe('installed')
    expect(canInstall()).toBe(false)
  })

  it('reports ios-manual for iOS browsers without a native prompt', () => {
    stubMatchMedia(false)
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', platform: 'iPhone', maxTouchPoints: 5, onLine: true })
    initPwa()
    expect(pwaState.capability).toBe('ios-manual')
    expect(canInstall()).toBe(false)
  })

  it('becomes installable when the browser fires beforeinstallprompt', async () => {
    stubMatchMedia(false)
    initPwa()
    expect(pwaState.capability).toBe('unsupported')
    const prompt = fireInstallPrompt()
    expect(pwaState.capability).toBe('installable')
    expect(canInstall()).toBe(true)
    const outcome = await promptInstall()
    expect(prompt).toHaveBeenCalled()
    expect(outcome).toBe('accepted')
    expect(pwaState.capability).toBe('installed')
  })

  it('promptInstall reports unavailable without a deferred prompt', async () => {
    stubMatchMedia(false)
    initPwa()
    expect(await promptInstall()).toBe('unavailable')
  })
})

describe('pwa update flow', () => {
  it('posts SKIP_WAITING to the waiting worker and reloads on controllerchange', async () => {
    stubMatchMedia(false)
    const postMessage = vi.fn()
    const waiting = { state: 'installed', postMessage } as unknown as ServiceWorker
    const listeners = new Map<string, () => void>()
    const register = vi.fn().mockResolvedValue({
      waiting,
      installing: null,
      addEventListener: vi.fn(),
    })
    vi.stubGlobal('navigator', {
      serviceWorker: {
        register,
        controller: {},
        addEventListener: (name: string, fn: () => void) => listeners.set(name, fn),
      },
      userAgent: 'node', onLine: true, platform: 'test', maxTouchPoints: 0,
    })
    initPwa()
    await Promise.resolve()
    await Promise.resolve()
    expect(register).toHaveBeenCalledWith('/sw.js')
    expect(pwaState.updateReady).toBe(true)
    expect(applyUpdate()).toBe(true)
    expect(postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
  })

  it('applyUpdate refuses without a waiting worker', () => {
    expect(applyUpdate()).toBe(false)
  })
})
