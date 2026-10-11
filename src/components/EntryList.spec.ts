import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import EntryList from './EntryList.vue'
import type { TimeEntry } from '../types'

function entry(overrides: Partial<TimeEntry>): TimeEntry {
  return {
    id: overrides.id ?? `e-${Math.random().toString(36).slice(2, 8)}`,
    type: 'work',
    start: new Date(2026, 8, 9, 9).getTime(),
    end: new Date(2026, 8, 9, 10).getTime(),
    ...overrides,
  }
}

describe('EntryList', () => {
  it('renders each entry with its duration', () => {
    const entries = [
      entry({ id: 'a', description: 'morning' }),
      entry({ id: 'b', start: new Date(2026, 8, 9, 11).getTime(), end: new Date(2026, 8, 9, 11, 30).getTime() }),
    ]
    const wrapper = mount(EntryList, { props: { entries } })
    const items = wrapper.findAll('[data-test="entry-item"]')
    expect(items).toHaveLength(2)
    expect(wrapper.text()).toContain('1:00')
    expect(wrapper.text()).toContain('30:00')
  })

  it('shows description and category when present', () => {
    const entries = [entry({ id: 'a', description: 'standup', category: 'planning' })]
    const wrapper = mount(EntryList, { props: { entries } })
    expect(wrapper.text()).toContain('standup')
    expect(wrapper.text()).toContain('planning')
  })

  it('requests deletion with the entry id instead of deleting immediately', async () => {
    const entries = [entry({ id: 'a' }), entry({ id: 'b' })]
    const wrapper = mount(EntryList, { props: { entries } })
    await wrapper.findAll('[data-test="delete-entry"]')[1]!.trigger('click')
    expect(wrapper.emitted('request-delete')).toEqual([['b']])
    expect(wrapper.emitted('delete')).toBeUndefined()
  })

  it('emits edit with the entry id and gives both actions accessible names', async () => {
    const entries = [entry({ id: 'a' })]
    const wrapper = mount(EntryList, { props: { entries } })
    const edit = wrapper.find('[data-test="edit-entry"]')
    expect(edit.attributes('aria-label')).toMatch(/^Edit entry at /)
    await edit.trigger('click')
    expect(wrapper.emitted('edit')).toEqual([['a']])
    expect(wrapper.find('[data-test="delete-entry"]').attributes('aria-label')).toMatch(/^Delete entry at /)
  })

  it('renders an empty state when there are no entries', () => {
    const wrapper = mount(EntryList, { props: { entries: [] } })
    expect(wrapper.find('[data-test="entry-item"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="empty-state"]').exists()).toBe(true)
  })
})
