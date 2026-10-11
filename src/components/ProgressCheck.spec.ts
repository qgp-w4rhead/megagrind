import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import ProgressCheck from './ProgressCheck.vue'
import { useMegagrindStore } from '../stores/megagrind'

const T0 = new Date(2026, 8, 9, 15).getTime()

const requestPermission = vi.fn(async () => 'granted' as NotificationPermission)

class FakeNotification {
  static permission: NotificationPermission = 'default'
  static requestPermission = requestPermission
}

function localStore() {
  const store = useMegagrindStore()
  store.settings.backendMode = 'local'
  return store
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(T0)
  requestPermission.mockClear()
  FakeNotification.permission = 'default'
  vi.stubGlobal('Notification', FakeNotification)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('ProgressCheck presentation', () => {
  it('never requests notification permission on mount', () => {
    localStore()
    mount(ProgressCheck)
    expect(requestPermission).not.toHaveBeenCalled()
  })

  it('requests notification permission exactly once when the user enables alerts', async () => {
    localStore()
    const wrapper = mount(ProgressCheck)
    await wrapper.find('[data-test="enable-alerts"]').trigger('click')
    expect(requestPermission).toHaveBeenCalledTimes(1)
  })

  it('shows the configured interval in the prompt copy', async () => {
    const store = localStore()
    store.updateSettings({ progressCheckInterval: 20 })
    store.startSession('work')
    store.progressCheck.pendingSessionId = store.currentWorkSessionId
    const wrapper = mount(ProgressCheck)
    await nextTick()
    expect(wrapper.find('.prompt-card').text()).toContain('last 20 minutes')
  })

  it('shows paused outside work', () => {
    const store = localStore()
    store.progressCheck.pausedReason = 'not-working'
    const wrapper = mount(ProgressCheck)
    expect(wrapper.find('.paused-info').exists()).toBe(true)
  })

  it('a rejected permission request is reported in-app without throwing', async () => {
    localStore()
    requestPermission.mockRejectedValueOnce(new Error('dismissed'))
    const wrapper = mount(ProgressCheck)
    await wrapper.find('[data-test="enable-alerts"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="alert-status"]').text()).toContain('could not be enabled')
    expect(wrapper.find('[data-test="enable-alerts"]').exists()).toBe(true)
  })

  it('a denied permission hides the enable offer and is never reported as enabled', async () => {
    localStore()
    requestPermission.mockResolvedValueOnce('denied')
    const wrapper = mount(ProgressCheck)
    await wrapper.find('[data-test="enable-alerts"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="enable-alerts"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="alert-status"]').text()).toContain('blocked')
    expect(wrapper.text()).not.toContain('Browser alerts on')
  })

  it('duplicate clicks while a request is in flight make a single request', async () => {
    localStore()
    requestPermission.mockReturnValueOnce(new Promise(() => {}))
    const wrapper = mount(ProgressCheck)
    await wrapper.find('[data-test="enable-alerts"]').trigger('click')
    await wrapper.find('[data-test="enable-alerts"]').trigger('click')
    expect(requestPermission).toHaveBeenCalledTimes(1)
  })

  it('stop activity on the pending prompt stops the session without counting as blocked', async () => {
    const store = localStore()
    store.startSession('work')
    store.progressCheck.pendingSessionId = store.currentWorkSessionId
    const wrapper = mount(ProgressCheck)
    await nextTick()
    await wrapper.find('[data-test="prompt-stop"]').trigger('click')
    expect(store.activeSession.type).toBeNull()
    expect(store.todayBlockedCount).toBe(0)
  })

  it('granted permission with alerts switched off says allowed-but-off, not on', () => {
    FakeNotification.permission = 'granted'
    const store = localStore()
    store.updateSettings({ notificationsEnabled: false })
    const wrapper = mount(ProgressCheck)
    expect(wrapper.text()).toContain('allowed, but turned off')
    expect(wrapper.text()).not.toContain('Browser alerts on')
  })

  it('a successful explicit enable turns browser alerts on', async () => {
    const store = localStore()
    store.updateSettings({ notificationsEnabled: false })
    requestPermission.mockResolvedValueOnce('granted')
    const wrapper = mount(ProgressCheck)
    await wrapper.find('[data-test="enable-alerts"]').trigger('click')
    await flushPromises()
    expect(store.settings.notificationsEnabled).toBe(true)
    expect(wrapper.text()).toContain('Browser alerts on')
  })

  it('a denied request never turns browser alerts on', async () => {
    const store = localStore()
    store.updateSettings({ notificationsEnabled: false })
    requestPermission.mockResolvedValueOnce('denied')
    const wrapper = mount(ProgressCheck)
    await wrapper.find('[data-test="enable-alerts"]').trigger('click')
    await flushPromises()
    expect(store.settings.notificationsEnabled).toBe(false)
    expect(wrapper.text()).not.toContain('Browser alerts on')
  })

  it('a rejected request never turns browser alerts on', async () => {
    const store = localStore()
    store.updateSettings({ notificationsEnabled: false })
    requestPermission.mockRejectedValueOnce(new Error('dismissed'))
    const wrapper = mount(ProgressCheck)
    await wrapper.find('[data-test="enable-alerts"]').trigger('click')
    await flushPromises()
    expect(store.settings.notificationsEnabled).toBe(false)
  })

  it('permission changed outside the app is reflected on visibility refresh', () => {
    const store = localStore()
    expect(store.alertsPermission).toBe('default')
    FakeNotification.permission = 'denied'
    document.dispatchEvent(new Event('visibilitychange'))
    expect(store.alertsPermission).toBe('denied')
  })

  it('a granted permission stops offering the enable button', () => {
    FakeNotification.permission = 'granted'
    localStore()
    const wrapper = mount(ProgressCheck)
    expect(wrapper.find('[data-test="enable-alerts"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Browser alerts on')
  })
})
