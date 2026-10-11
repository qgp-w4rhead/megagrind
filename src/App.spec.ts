import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import App from './App.vue'
import TrackView from './views/TrackView.vue'
import HistoryView from './components/HistoryView.vue'
import { useMegagrindStore } from './stores/megagrind'

const MIN = 60_000
const T0 = new Date(2026, 8, 9, 15).getTime()

const requestPermission = vi.fn(async () => 'granted' as NotificationPermission)

class FakeNotification {
  static permission: NotificationPermission = 'default'
  static requestPermission = requestPermission
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

function mountApp() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: TrackView },
      { path: '/dashboard', component: { template: '<div />' } },
      { path: '/history', component: { template: '<div />' } },
      { path: '/settings', component: { template: '<div />' } },
    ],
  })
  return { router, wrapper: mount(App, { global: { plugins: [router] } }) }
}

function prepareStore() {
  const store = useMegagrindStore()
  store.settings.backendMode = 'local'
  store.settings.darkMode = 'dark'
  return store
}

describe('App progress scheduler', () => {
  it('keeps one progress check and its prompt reachable across route changes', async () => {
    const store = prepareStore()
    store.startSession('work')
    const { router, wrapper } = mountApp()
    await router.push('/')
    await router.isReady()
    await router.push('/dashboard')
    await router.push('/history')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(15 * MIN)
    await flushPromises()
    expect(wrapper.findAll('[data-test="progress-check"]')).toHaveLength(1)
    expect(wrapper.find('.prompt-card').exists()).toBe(true)
    expect(requestPermission).not.toHaveBeenCalled()
  })
})

function mountHistoryApp() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: TrackView },
      { path: '/history', component: HistoryView },
    ],
  })
  return { router, wrapper: mount(App, { global: { plugins: [router] } }) }
}

async function openDayWithFirstEntry(day: number) {
  const { router, wrapper } = mountHistoryApp()
  await router.push('/history')
  await router.isReady()
  await flushPromises()
  await wrapper.find(`[data-test="day-${day}"]`).trigger('click')
  await flushPromises()
  return { wrapper }
}

describe('App entry mutations', () => {
  it('refuses to delete a running entry and keeps it running', async () => {
    const store = prepareStore()
    store.entries.push({ id: 'live', type: 'work', start: new Date(2026, 8, 9, 14).getTime(), end: null })
    const { wrapper } = await openDayWithFirstEntry(9)
    await wrapper.find('.delete-entry-btn').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Finish the running entry with Stop or Edit before deleting it.')
    expect(wrapper.find('[data-test="delete-confirm"]').exists()).toBe(true)
    expect(store.entries.find((e) => e.id === 'live')?.end).toBeNull()
  })

  it('cancel keeps a closed entry; confirm deletes and Undo restores the exact record', async () => {
    const store = prepareStore()
    const original = { id: 'closed-1', type: 'work' as const, start: new Date(2026, 8, 9, 9).getTime(), end: new Date(2026, 8, 9, 10).getTime(), description: 'draft' }
    store.entries.push({ ...original })
    const { wrapper } = await openDayWithFirstEntry(9)
    await wrapper.find('.delete-entry-btn').trigger('click')
    await wrapper.find('[data-test="delete-cancel"]').trigger('click')
    await flushPromises()
    expect(store.entries.map((e) => e.id)).toEqual(['closed-1'])

    await wrapper.find('.delete-entry-btn').trigger('click')
    await wrapper.find('[data-test="delete-confirm"]').trigger('click')
    await flushPromises()
    expect(store.entries).toHaveLength(0)
    await wrapper.find('[data-test="undo-delete"]').trigger('click')
    await flushPromises()
    expect(store.entries[0]).toEqual(original)
    expect(wrapper.text()).toContain('Entry restore saved.')
  })

  it('undo of a closed entry restores it while a newer activity keeps running', async () => {
    const store = prepareStore()
    store.entries.push({ id: 'closed-2', type: 'work', start: new Date(2026, 8, 9, 9).getTime(), end: new Date(2026, 8, 9, 10).getTime() })
    const { wrapper } = await openDayWithFirstEntry(9)
    await wrapper.find('.delete-entry-btn').trigger('click')
    await wrapper.find('[data-test="delete-confirm"]').trigger('click')
    store.startSession('move')
    await flushPromises()
    await wrapper.find('[data-test="undo-delete"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Entry restore saved.')
    expect(store.entries.find((e) => e.id === 'closed-2')?.end).toBe(new Date(2026, 8, 9, 10).getTime())
    expect(store.entries.filter((e) => e.end === null).map((e) => e.type)).toEqual(['move'])
  })
})

describe('App editor and picker state', () => {
  it('accepting the discard closes the dirty editor, then navigates', async () => {
    const store = prepareStore()
    store.startSession('work')
    const { router, wrapper } = mountApp()
    await router.push('/')
    await router.isReady()
    await flushPromises()
    vi.stubGlobal('confirm', vi.fn(() => true))
    await wrapper.find('[data-test="now-edit"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-test="description-input"]').setValue('draft')
    await router.push('/history')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/history')
    expect(wrapper.find('[data-test="manual-entry"]').exists()).toBe(false)
  })

  it('declining the discard keeps both the route and the draft', async () => {
    const store = prepareStore()
    store.startSession('work')
    const { router, wrapper } = mountApp()
    await router.push('/')
    await router.isReady()
    await flushPromises()
    vi.stubGlobal('confirm', vi.fn(() => false))
    await wrapper.find('[data-test="now-edit"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-test="description-input"]').setValue('draft')
    await router.push('/history')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/')
    expect(wrapper.find('[data-test="manual-entry"]').exists()).toBe(true)
    expect((wrapper.find('[data-test="description-input"]').element as HTMLInputElement).value).toBe('draft')
  })

  it('reopening the activity picker starts from the list, not a stale selection', async () => {
    const store = prepareStore()
    store.startSession('work')
    const { router, wrapper } = mountApp()
    await router.push('/')
    await router.isReady()
    await flushPromises()
    await wrapper.find('[data-test="now-switch"]').trigger('click')
    await flushPromises()
    await wrapper.findAll('[data-test="pick-activity"]')[0]!.trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="start-picked"]').exists()).toBe(true)
    await wrapper.findAll('.app-dialog-close')[0]!.trigger('click')
    await flushPromises()
    await wrapper.find('[data-test="now-switch"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="start-picked"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-test="pick-activity"]').length).toBeGreaterThan(0)
  })
})

describe('App shell', () => {
  it('keeps exactly one active-activity bar across routes', async () => {
    prepareStore()
    const { router, wrapper } = mountApp()
    await router.push('/')
    await router.isReady()
    expect(wrapper.findAll('.now-bar')).toHaveLength(1)
    await router.push('/history')
    await flushPromises()
    expect(wrapper.findAll('.now-bar')).toHaveLength(1)
  })

  it('starting a favorite without a description runs that activity directly', async () => {
    const store = prepareStore()
    const { router, wrapper } = mountApp()
    await router.push('/')
    await router.isReady()
    const favorite = wrapper.findAll('[data-test="favorite"]')[0]!
    await favorite.trigger('click')
    const open = store.entries.filter((e) => e.end === null)
    expect(open).toHaveLength(1)
    expect(open[0]!.description).toBeUndefined()
  })

  it('switching closes the old activity and starts the new one at the same timestamp', async () => {
    const store = prepareStore()
    const { router, wrapper } = mountApp()
    await router.push('/')
    await router.isReady()
    store.startSession('work')
    vi.advanceTimersByTime(60 * MIN)
    const sleep = wrapper.findAll('[data-test="favorite"]').find((b) => b.text() === 'Sleep')!
    await sleep.trigger('click')
    const work = store.entries.find((e) => e.type === 'work')!
    const nap = store.entries.find((e) => e.type === 'sleep')!
    expect(work.end).toBe(T0 + 60 * MIN)
    expect(nap.start).toBe(work.end)
    expect(store.entries.filter((e) => e.end === null).map((e) => e.type)).toEqual(['sleep'])
  })

  it('stopping an activity starts idle only when idle tracking is enabled', async () => {
    const store = prepareStore()
    store.settings.idleTimeEnabled = true
    store.startSession('work')
    const { router, wrapper } = mountApp()
    await router.push('/')
    await router.isReady()
    await wrapper.find('[data-test="now-stop"]').trigger('click')
    expect(store.entries.filter((e) => e.end === null).map((e) => e.type)).toEqual(['idle'])

    store.settings.idleTimeEnabled = false
    store.startSession('move')
    await flushPromises()
    await wrapper.find('[data-test="now-stop"]').trigger('click')
    expect(store.entries.filter((e) => e.end === null)).toHaveLength(0)
  })
})
