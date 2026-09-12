import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import SessionTracker from './SessionTracker.vue'
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

describe('SessionTracker', () => {
  it('renders the tracker label and icon for the type', () => {
    localStore()
    const wrapper = mount(SessionTracker, { props: { type: 'sleep' } })
    expect(wrapper.text()).toContain('Sleep')
    expect(wrapper.find('[data-test="tracker-icon"]').exists()).toBe(true)
  })

  it('simple type: start button starts a session immediately', async () => {
    const store = localStore()
    const spy = vi.spyOn(store, 'startSession')
    const wrapper = mount(SessionTracker, { props: { type: 'sleep' } })
    await wrapper.find('[data-test="start-btn"]').trigger('click')
    expect(spy).toHaveBeenCalledWith('sleep', undefined, undefined)
  })

  it('stop button stops the running session', async () => {
    const store = localStore()
    store.startSession('sleep')
    const spy = vi.spyOn(store, 'stopSession')
    const wrapper = mount(SessionTracker, { props: { type: 'sleep' } })
    await wrapper.find('[data-test="stop-btn"]').trigger('click')
    expect(spy).toHaveBeenCalled()
  })

  it('shows elapsed time while running', async () => {
    const store = localStore()
    store.startSession('sleep')
    const wrapper = mount(SessionTracker, { props: { type: 'sleep' } })
    vi.advanceTimersByTime(5000)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-test="elapsed"]').text()).toContain('0:05')
  })

  it('categories type renders a category dropdown and passes it to startSession', async () => {
    const store = localStore()
    store.settings.choreCategories = ['laundry', 'dishes']
    const spy = vi.spyOn(store, 'startSession')
    const wrapper = mount(SessionTracker, { props: { type: 'chores' } })
    await wrapper.find('[data-test="start-btn"]').trigger('click')
    const select = wrapper.find('[data-test="category-select"]')
    expect(select.exists()).toBe(true)
    await select.setValue('dishes')
    await wrapper.find('[data-test="confirm-start"]').trigger('click')
    expect(spy).toHaveBeenCalledWith('chores', expect.anything(), 'dishes')
  })

  it('requiresDescription blocks start until a description is entered', async () => {
    const store = localStore()
    const spy = vi.spyOn(store, 'startSession')
    const wrapper = mount(SessionTracker, { props: { type: 'work' } })
    await wrapper.find('[data-test="start-btn"]').trigger('click')
    // confirm disabled without description
    const confirm = wrapper.find('[data-test="confirm-start"]')
    expect(confirm.attributes('disabled')).toBeDefined()
    await wrapper.find('[data-test="description-input"]').setValue('deep work')
    await wrapper.find('[data-test="confirm-start"]').trigger('click')
    expect(spy).toHaveBeenCalledWith('work', 'deep work', expect.anything())
  })

  it('passive type (idle) shows elapsed with no start button', () => {
    const store = localStore()
    store.entries.push({
      id: 'idle1',
      type: 'idle',
      start: Date.now() - 10_000,
      end: null,
    })
    const wrapper = mount(SessionTracker, { props: { type: 'idle' } })
    expect(wrapper.find('[data-test="start-btn"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="elapsed"]').exists()).toBe(true)
  })

  it('shows today and week totals', () => {
    const store = localStore()
    store.entries.push({
      id: 'w1',
      type: 'sleep',
      start: new Date(2026, 8, 9, 1).getTime(),
      end: new Date(2026, 8, 9, 3).getTime(),
    })
    const wrapper = mount(SessionTracker, { props: { type: 'sleep' } })
    expect(wrapper.find('[data-test="today-total"]').text()).toContain('2.0')
    expect(wrapper.find('[data-test="week-total"]').text()).toContain('2.0')
  })
})
