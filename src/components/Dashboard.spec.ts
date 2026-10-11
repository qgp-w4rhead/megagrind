import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import Dashboard from './Dashboard.vue'
import { useMegagrindStore } from '../stores/megagrind'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 8, 9, 15))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Dashboard', () => {
  it('counts blocked checks recorded today separately from the streak, without goal wording', () => {
    const store = useMegagrindStore()
    store.settings.backendMode = 'local'
    store.startSession('work')
    vi.advanceTimersByTime(5 * 60_000)
    store.recordProgressCheck(false)
    vi.advanceTimersByTime(60_000)
    store.recordProgressCheck(false)
    vi.advanceTimersByTime(60_000)
    store.recordProgressCheck(true)
    const wrapper = mount(Dashboard)
    expect(wrapper.find('[data-test="blocked-today"]').text()).toBe('2')
    expect(wrapper.find('[data-test="blocked-streak"]').text()).toBe('0')
    expect(wrapper.text()).not.toMatch(/Bill Gates|of work goal|Weekly Progress|Red Checks/)
  })
})
