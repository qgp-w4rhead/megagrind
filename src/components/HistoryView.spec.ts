import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import HistoryView from './HistoryView.vue'
import { useMegagrindStore } from '../stores/megagrind'
import type { TimeEntry } from '../types'

function localStore() {
  const store = useMegagrindStore()
  store.settings.backendMode = 'local'
  return store
}

function mountView() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div />' } }],
  })
  return mount(HistoryView, { global: { plugins: [router] } })
}

function entry(overrides: Partial<TimeEntry>): TimeEntry {
  return {
    id: overrides.id ?? `e-${Math.random().toString(36).slice(2, 8)}`,
    type: 'work',
    start: 0,
    end: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  // Sep 9 2026 (Wednesday); September 2026 starts on a Tuesday.
  vi.setSystemTime(new Date(2026, 8, 9, 15))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('HistoryView month grid', () => {
  it('day cell aggregates all types, not just work', async () => {
    const store = localStore()
    store.entries.push(
      entry({ id: 'w', type: 'work', start: new Date(2026, 8, 9, 9).getTime(), end: new Date(2026, 8, 9, 11).getTime() }),
      entry({ id: 's', type: 'sleep', start: new Date(2026, 8, 9, 1).getTime(), end: new Date(2026, 8, 9, 7).getTime() }),
    )
    const wrapper = mountView()
    const cell = wrapper.find('[data-test="day-9"]')
    expect(cell.exists()).toBe(true)
    expect(cell.find('[data-test="dot-work"]').exists()).toBe(true)
    expect(cell.find('[data-test="dot-sleep"]').exists()).toBe(true)
    // 2h work + 6h sleep = 8h total shown on the cell
    expect(cell.text()).toContain('8h')
  })

  it('shows no dots on days without entries', () => {
    localStore()
    const wrapper = mountView()
    const cell = wrapper.find('[data-test="day-10"]')
    expect(cell.exists()).toBe(true)
    expect(cell.find('[data-test^="dot-"]').exists()).toBe(false)
  })

  it('week rows align to weekRolloverDay (Monday start → 1 blank before Sep 1)', () => {
    const store = localStore()
    store.settings.weekRolloverDay = 1
    const wrapper = mountView()
    const cells = wrapper.findAll('[data-test^="day-"]')
    const firstReal = cells.findIndex((c) => c.attributes('data-test') === 'day-1')
    // Sep 1 2026 is a Tuesday; with Monday-start weeks there is 1 blank.
    expect(firstReal).toBe(1)
  })

  it('week rows align to weekRolloverDay (Sunday start → 2 blanks before Sep 1)', () => {
    const store = localStore()
    store.settings.weekRolloverDay = 0
    const wrapper = mountView()
    const cells = wrapper.findAll('[data-test^="day-"]')
    const firstReal = cells.findIndex((c) => c.attributes('data-test') === 'day-1')
    expect(firstReal).toBe(2)
  })

  it('weekday headers follow the rollover day', () => {
    const store = localStore()
    store.settings.weekRolloverDay = 1
    const wrapper = mountView()
    const headers = wrapper.findAll('.calendar-day-header').map((h) => h.text())
    expect(headers).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
  })
})

describe('HistoryView day timeline', () => {
  it('sorts entries chronologically regardless of insertion order', async () => {
    const store = localStore()
    store.entries.push(
      entry({ id: 'late', type: 'work', start: new Date(2026, 8, 9, 14).getTime(), end: new Date(2026, 8, 9, 15).getTime() }),
      entry({ id: 'early', type: 'work', start: new Date(2026, 8, 9, 9).getTime(), end: new Date(2026, 8, 9, 10).getTime() }),
    )
    const wrapper = mountView()
    await wrapper.find('[data-test="day-9"]').trigger('click')
    const ids = wrapper
      .findAll('[data-test="timeline-entry"]')
      .map((el) => el.attributes('data-entry-id'))
    expect(ids).toEqual(['early', 'late'])
  })

  it('shows an untracked gap between consecutive entries', async () => {
    const store = localStore()
    store.entries.push(
      entry({ id: 'a', type: 'work', start: new Date(2026, 8, 9, 9).getTime(), end: new Date(2026, 8, 9, 10).getTime() }),
      entry({ id: 'b', type: 'work', start: new Date(2026, 8, 9, 12).getTime(), end: new Date(2026, 8, 9, 13).getTime() }),
    )
    const wrapper = mountView()
    await wrapper.find('[data-test="day-9"]').trigger('click')
    const gap = wrapper.find('[data-test="timeline-gap"]')
    expect(gap.exists()).toBe(true)
    // 10:00 → 12:00 = 2h untracked
    expect(gap.text()).toContain('2h 0m')
  })

  it('shows no gap when entries are contiguous', async () => {
    const store = localStore()
    store.entries.push(
      entry({ id: 'a', type: 'work', start: new Date(2026, 8, 9, 9).getTime(), end: new Date(2026, 8, 9, 10).getTime() }),
      entry({ id: 'b', type: 'work', start: new Date(2026, 8, 9, 10).getTime(), end: new Date(2026, 8, 9, 11).getTime() }),
    )
    const wrapper = mountView()
    await wrapper.find('[data-test="day-9"]').trigger('click')
    expect(wrapper.find('[data-test="timeline-gap"]').exists()).toBe(false)
  })

  it('day total aggregates all types', async () => {
    const store = localStore()
    store.entries.push(
      entry({ id: 'w', type: 'work', start: new Date(2026, 8, 9, 9).getTime(), end: new Date(2026, 8, 9, 11).getTime() }),
      entry({ id: 's', type: 'sleep', start: new Date(2026, 8, 9, 12).getTime(), end: new Date(2026, 8, 9, 14).getTime() }),
    )
    const wrapper = mountView()
    await wrapper.find('[data-test="day-9"]').trigger('click')
    // 2h + 2h = 4h
    expect(wrapper.find('.day-summary').text()).toContain('4h 0m')
  })
})
