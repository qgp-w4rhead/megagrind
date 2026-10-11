import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import TrackView from './TrackView.vue'
import { useMegagrindStore } from '../stores/megagrind'

function localStore() {
  const store = useMegagrindStore()
  store.settings.backendMode = 'local'
  return store
}

function mountToday() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div />' } }, { path: '/history', component: { template: '<div />' } }],
  })
  return mount(TrackView, { global: { plugins: [router] } })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 8, 9, 15))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('TrackView (Today workspace)', () => {
  it('shows a Today heading and no per-type tracker wall', () => {
    localStore()
    const wrapper = mountToday()
    expect(wrapper.find('h1').text()).toBe('Today')
    expect(wrapper.findAll('[data-test^="tracker-"]')).toHaveLength(0)
  })

  it('offers at most six favorites that start directly', async () => {
    localStore()
    const wrapper = mountToday()
    const favorites = wrapper.findAll('[data-test="favorite"]')
    expect(favorites.length).toBeGreaterThan(0)
    expect(favorites.length).toBeLessThanOrEqual(6)
    expect(favorites[0]!.text()).toBe('Work')
    await favorites[0]!.trigger('click')
    expect(wrapper.emitted('start-activity')![0]![0]).toEqual({ type: 'work', category: undefined })
  })

  it('a favorite reuses the last work category when one exists', async () => {
    const store = localStore()
    store.entries.push({ id: 'w1', type: 'work', start: new Date(2026, 8, 9, 9).getTime(), end: new Date(2026, 8, 9, 10).getTime(), category: 'dev' })
    const wrapper = mountToday()
    await wrapper.findAll('[data-test="favorite"]')[0]!.trigger('click')
    expect(wrapper.emitted('start-activity')![0]![0]).toEqual({ type: 'work', category: 'dev' })
  })

  it('shows the empty state with add and start options when nothing is recorded', () => {
    localStore()
    const wrapper = mountToday()
    expect(wrapper.find('[data-test="today-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="recent-item"]').exists()).toBe(false)
  })

  it('bounds the recent list to five finished entries and emits the original id on edit', async () => {
    const store = localStore()
    for (let i = 0; i < 7; i++) {
      store.entries.push({
        id: `e${i}`,
        type: 'work',
        start: new Date(2026, 8, 9, 8 + i).getTime(),
        end: new Date(2026, 8, 9, 8 + i, 30).getTime(),
      })
    }
    const wrapper = mountToday()
    expect(wrapper.findAll('[data-test="recent-item"]')).toHaveLength(5)
    await wrapper.findAll('[data-test="edit-recent"]')[0]!.trigger('click')
    expect(wrapper.emitted('edit-entry')![0]![0]).toEqual({ id: 'e6' })
  })

  it('add missed time and all activities emit their events', async () => {
    localStore()
    const wrapper = mountToday()
    await wrapper.find('[data-test="add-missed"]').trigger('click')
    await wrapper.find('[data-test="open-activities"]').trigger('click')
    expect(wrapper.emitted('add-entry')).toHaveLength(1)
    expect(wrapper.emitted('open-activities')).toHaveLength(1)
  })
})
