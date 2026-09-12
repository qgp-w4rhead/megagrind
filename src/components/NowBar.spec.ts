import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import NowBar from './NowBar.vue'
import { useMegagrindStore } from '../stores/megagrind'

function localStore() {
  const store = useMegagrindStore()
  store.settings.backendMode = 'local'
  return store
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 8, 9, 15))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('NowBar', () => {
  it('shows the active session label and ticking elapsed', async () => {
    const store = localStore()
    store.startSession('work', 'task', 'dev')
    const wrapper = mount(NowBar)
    vi.advanceTimersByTime(5000)
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('Work')
    expect(wrapper.find('[data-test="now-elapsed"]').text()).toContain('0:05')
  })

  it('shows the session description when present', () => {
    const store = localStore()
    store.startSession('work', 'deep work', 'dev')
    const wrapper = mount(NowBar)
    expect(wrapper.text()).toContain('deep work')
  })

  it('stop button stops the session', async () => {
    const store = localStore()
    store.startSession('work', 'task', 'dev')
    const spy = vi.spyOn(store, 'stopSession')
    const wrapper = mount(NowBar)
    await wrapper.find('[data-test="now-stop"]').trigger('click')
    expect(spy).toHaveBeenCalled()
  })

  it('shows an idle state when nothing is running', () => {
    localStore()
    const wrapper = mount(NowBar)
    expect(wrapper.find('[data-test="now-stop"]').exists()).toBe(false)
    expect(wrapper.text()).toMatch(/nothing|idle|no active/i)
  })
})
