import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import SettingsPanel from './SettingsPanel.vue'
import { useMegagrindStore } from '../stores/megagrind'
import { useApi } from '../composables/useApi'

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: 'ok', active: 'sqlite', available: ['sqlite'] }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function mountSettings() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/settings', component: SettingsPanel },
      { path: '/history', component: { template: '<div />' } },
    ],
  })
  await router.push('/settings')
  await router.isReady()
  const wrapper = mount({ template: '<router-view />' }, { global: { plugins: [router] }, attachTo: document.body })
  return { wrapper, router }
}

describe('SettingsPanel', () => {
  it('associates labelled fields with their controls', async () => {
    useMegagrindStore()
    const { wrapper } = await mountSettings()
    const labelled = wrapper.findAll('label[for]')
    expect(labelled.length).toBeGreaterThan(10)
    for (const label of labelled) {
      const control = document.getElementById(label.attributes('for')!)
      expect(control, `control for "${label.text()}"`).not.toBeNull()
    }
    wrapper.unmount()
  })

  it('blocks a negative allocation with a message and never saves it', async () => {
    const store = useMegagrindStore()
    const { wrapper } = await mountSettings()
    const sleep = wrapper.find('#settings-field-1')
    await sleep.setValue(-1)
    expect(wrapper.find('[data-test="settings-errors"]').text()).toContain('0 to 168')
    expect(wrapper.find('.btn-save').attributes('disabled')).toBeDefined()
    const before = store.settings.weeklyAllocations.sleep
    await wrapper.find('.btn-save').trigger('click')
    expect(store.settings.weeklyAllocations.sleep).toBe(before)
    wrapper.unmount()
  })

  it('tests a candidate URL without changing the active endpoint', async () => {
    const store = useMegagrindStore()
    store.settings.backendMode = 'sqlite'
    const api = useApi()
    api.setBaseUrl('')
    const { wrapper } = await mountSettings()
    const url = wrapper.find('#settings-field-19')
    await url.setValue('http://candidate.test:4000')
    await wrapper.find('[data-test="test-connection"]').trigger('click')
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledWith('http://candidate.test:4000/api/health', expect.anything())
    expect(api.baseUrl.value).toBe('')
    expect(store.settings.backendUrl).toBe('')
    wrapper.unmount()
  })

  it('asks before leaving with an unsaved draft and stays when declined', async () => {
    useMegagrindStore()
    const confirmSpy = vi.fn(() => false)
    vi.stubGlobal('confirm', confirmSpy)
    const { wrapper, router } = await mountSettings()
    await wrapper.find('#settings-field-1').setValue(12)
    await router.push('/history')
    await flushPromises()
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(router.currentRoute.value.path).toBe('/settings')
    wrapper.unmount()
  })

  it('describes local storage as on this device and does not claim sync', async () => {
    useMegagrindStore()
    const { wrapper } = await mountSettings()
    expect(wrapper.text()).toContain('Local on this device')
    expect(wrapper.find('[data-test="storage-status"]').text()).toContain('Saved on this device only')
    expect(wrapper.text()).not.toContain('Synced')
    wrapper.unmount()
  })

  it('renames, reorders, and archives activities via stable ids on save', async () => {
    const store = useMegagrindStore()
    const { wrapper } = await mountSettings()
    const nameInput = wrapper.find('input[aria-label="Display name for work"]')
    await nameInput.setValue('Deep Work')
    // Reorder: move Sleep (index 2 in built-in order) above Chores.
    await wrapper.find('button[aria-label="Move Sleep up"]').trigger('click')
    await wrapper.find('button[aria-label="Archive Leisure"]').trigger('click')
    await wrapper.find('.btn-save').trigger('click')
    const work = store.settings.activities.find((a) => a.id === 'work')!
    expect(work.label).toBe('Deep Work')
    const sleepOrder = store.settings.activities.find((a) => a.id === 'sleep')!.order
    const choresOrder = store.settings.activities.find((a) => a.id === 'chores')!.order
    expect(sleepOrder).toBeLessThan(choresOrder)
    expect(store.settings.activities.find((a) => a.id === 'leisure')!.archived).toBe(true)
    wrapper.unmount()
  })

  it('archives a custom activity referenced by history instead of deleting it', async () => {
    const store = useMegagrindStore()
    store.settings.customChronos.push('gardening')
    store.entries.push({ id: 'e1', type: 'gardening', start: Date.now() - 3600_000, end: Date.now() - 1800_000 })
    vi.stubGlobal('confirm', vi.fn(() => true))
    const { wrapper } = await mountSettings()
    await wrapper.find('button[aria-label="Remove gardening"]').trigger('click')
    await wrapper.find('.btn-save').trigger('click')
    const def = store.settings.activities.find((a) => a.id === 'gardening')
    expect(def).toBeDefined()
    expect(def!.archived).toBe(true)
    expect(def!.label).toBe('Gardening')
    expect(store.entries.find((e) => e.id === 'e1')!.type).toBe('gardening')
    wrapper.unmount()
  })

  it('blocks saving while an activity name is empty', async () => {
    const store = useMegagrindStore()
    const { wrapper } = await mountSettings()
    await wrapper.find('input[aria-label="Display name for work"]').setValue('   ')
    expect(wrapper.find('[data-test="settings-errors"]').text()).toContain('non-empty')
    await wrapper.find('.btn-save').trigger('click')
    expect(store.settings.activities.find((a) => a.id === 'work')!.label).toBe('Work')
    wrapper.unmount()
  })
})
