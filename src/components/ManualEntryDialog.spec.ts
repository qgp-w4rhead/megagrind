import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import ManualEntryDialog from './ManualEntryDialog.vue'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 8, 9, 15))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ManualEntryDialog', () => {
  it('emits save with the real picked start and end times', async () => {
    const wrapper = mount(ManualEntryDialog, {
      props: { type: 'work', show: true },
    })
    await wrapper.find('[data-test="start-input"]').setValue('2026-09-09T09:00')
    await wrapper.find('[data-test="end-input"]').setValue('2026-09-09T11:30')
    await wrapper.find('[data-test="save-entry"]').trigger('click')
    const emitted = wrapper.emitted('save')
    expect(emitted).toHaveLength(1)
    const payload = emitted![0]![0] as { start: number; end: number; type: string }
    expect(payload.type).toBe('work')
    expect(payload.start).toBe(new Date(2026, 8, 9, 9, 0).getTime())
    expect(payload.end).toBe(new Date(2026, 8, 9, 11, 30).getTime())
    // Regression: end must be the picked time, not now + duration
    expect(payload.end).toBeLessThan(Date.now())
  })

  it('does not emit when end is before start', async () => {
    const wrapper = mount(ManualEntryDialog, {
      props: { type: 'work', show: true },
    })
    await wrapper.find('[data-test="start-input"]').setValue('2026-09-09T11:00')
    await wrapper.find('[data-test="end-input"]').setValue('2026-09-09T09:00')
    await wrapper.find('[data-test="save-entry"]').trigger('click')
    expect(wrapper.emitted('save')).toBeUndefined()
  })

  it('does not emit when fields are empty', async () => {
    const wrapper = mount(ManualEntryDialog, {
      props: { type: 'work', show: true },
    })
    await wrapper.find('[data-test="save-entry"]').trigger('click')
    expect(wrapper.emitted('save')).toBeUndefined()
  })

  it('includes description and category in the payload when provided', async () => {
    const wrapper = mount(ManualEntryDialog, {
      props: { type: 'work', show: true, categories: ['dev', 'planning'] },
    })
    await wrapper.find('[data-test="start-input"]').setValue('2026-09-09T09:00')
    await wrapper.find('[data-test="end-input"]').setValue('2026-09-09T10:00')
    await wrapper.find('[data-test="description-input"]').setValue('code review')
    await wrapper.find('[data-test="category-select"]').setValue('planning')
    await wrapper.find('[data-test="save-entry"]').trigger('click')
    const payload = wrapper.emitted('save')![0]![0] as {
      description?: string
      category?: string
    }
    expect(payload.description).toBe('code review')
    expect(payload.category).toBe('planning')
  })

  it('emits close when cancelled', async () => {
    const wrapper = mount(ManualEntryDialog, {
      props: { type: 'work', show: true },
    })
    await wrapper.find('[data-test="cancel-entry"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
