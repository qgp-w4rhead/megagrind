import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import TrackView from './TrackView.vue'
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

describe('TrackView', () => {
  it('renders the NowBar and a launcher per tracker type', () => {
    localStore()
    const wrapper = mount(TrackView)
    expect(wrapper.find('[data-test="now-bar"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="tracker-sleep"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="tracker-work"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="tracker-chores"]').exists()).toBe(true)
  })

  it('clicking a launcher starts that session', async () => {
    const store = localStore()
    const wrapper = mount(TrackView)
    await wrapper
      .find('[data-test="tracker-sleep"] [data-test="start-btn"]')
      .trigger('click')
    expect(store.activeSession?.type).toBe('sleep')
  })

  it('starting a new session closes the previous — single-session invariant', async () => {
    const store = localStore()
    store.startSession('work', 'task', 'dev')
    const wrapper = mount(TrackView)
    await wrapper
      .find('[data-test="tracker-sleep"] [data-test="start-btn"]')
      .trigger('click')
    expect(store.activeSession?.type).toBe('sleep')
    const open = store.entries.filter((e) => e.end === null)
    expect(open).toHaveLength(1)
    expect(open[0]!.type).toBe('sleep')
  })

  it('includes idle tracker only when idleTimeEnabled', () => {
    const store = localStore()
    store.settings.idleTimeEnabled = false
    const wrapper = mount(TrackView)
    expect(wrapper.find('[data-test="tracker-idle"]').exists()).toBe(false)
    store.settings.idleTimeEnabled = true
    const wrapper2 = mount(TrackView)
    expect(wrapper2.find('[data-test="tracker-idle"]').exists()).toBe(true)
  })
})
