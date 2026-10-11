import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import ManualEntryDialog from './ManualEntryDialog.vue'
import { useMegagrindStore } from '../stores/megagrind'

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

  describe('editing', () => {
    const start = new Date(2026, 8, 9, 9, 0, 0, 123).getTime()
    const end = new Date(2026, 8, 9, 10, 0, 0, 456).getTime()

    it('a description-only edit keeps the original id and exact timestamps', async () => {
      const entry = { id: 'e1', type: 'work' as const, start, end }
      const wrapper = mount(ManualEntryDialog, { props: { type: 'work', show: true, entry } })
      await wrapper.find('[data-test="description-input"]').setValue('reviewed')
      await wrapper.find('[data-test="save-entry"]').trigger('click')
      const payload = wrapper.emitted('save')![0]![0] as { id: string; start: number; end: number; description: string }
      expect(payload.id).toBe('e1')
      expect(payload.start).toBe(start)
      expect(payload.end).toBe(end)
      expect(payload.description).toBe('reviewed')
    })

    it('blocks a future end and shows the message', async () => {
      const wrapper = mount(ManualEntryDialog, { props: { type: 'work', show: true } })
      await wrapper.find('[data-test="start-input"]').setValue('2026-09-09T09:00')
      await wrapper.find('[data-test="end-input"]').setValue('2026-09-09T18:00')
      expect(wrapper.find('[data-test="form-errors"]').text()).toContain('End cannot be in the future.')
      expect(wrapper.find('[data-test="save-entry"]').attributes('disabled')).toBeDefined()
    })

    it('requires an explicit confirmation before saving over existing time', async () => {
      const store = useMegagrindStore()
      store.entries.push({ id: 'other', type: 'move', start: new Date(2026, 8, 9, 9).getTime(), end: new Date(2026, 8, 9, 10).getTime() })
      const wrapper = mount(ManualEntryDialog, { props: { type: 'work', show: true } })
      await wrapper.find('[data-test="start-input"]').setValue('2026-09-09T09:30')
      await wrapper.find('[data-test="end-input"]').setValue('2026-09-09T10:30')
      expect(wrapper.find('[data-test="overlap-preview"]').exists()).toBe(true)
      expect(wrapper.find('[data-test="save-entry"]').attributes('disabled')).toBeDefined()
      await wrapper.find('[data-test="confirm-overlap"]').setValue(true)
      await wrapper.find('[data-test="save-entry"]').trigger('click')
      expect(wrapper.emitted('save')).toHaveLength(1)
    })

    it('a signed correction keeps its sign and pair when only its context changes', async () => {
      const entry = { id: 'adj', type: 'work' as const, start: new Date(2026, 8, 9, 12).getTime(), end: new Date(2026, 8, 9, 11).getTime(), isCorrection: true, balancedWith: 'x' }
      const wrapper = mount(ManualEntryDialog, { props: { type: 'work', show: true, entry } })
      expect(wrapper.find('[data-test="start-input"]').attributes('disabled')).toBeDefined()
      await wrapper.find('[data-test="description-input"]').setValue('refund')
      await wrapper.find('[data-test="save-entry"]').trigger('click')
      const payload = wrapper.emitted('save')![0]![0] as { id: string; start: number; end: number }
      expect(payload).toMatchObject({ id: 'adj', start: entry.start, end: entry.end })
    })

    it('finishing a running entry at a chosen past time emits that end', async () => {
      const entry = { id: 'run', type: 'work' as const, start: new Date(2026, 8, 9, 9).getTime(), end: null }
      const wrapper = mount(ManualEntryDialog, { props: { type: 'work', show: true, entry } })
      await wrapper.find('[data-test="keep-running"]').setValue(false)
      await wrapper.find('[data-test="end-input"]').setValue('2026-09-09T10:15')
      await wrapper.find('[data-test="save-entry"]').trigger('click')
      const payload = wrapper.emitted('save')![0]![0] as { id: string; end: number | null }
      expect(payload.id).toBe('run')
      expect(payload.end).toBe(new Date(2026, 8, 9, 10, 15).getTime())
    })

    it('categories follow the selected activity: work then chores then sleep', async () => {
      const store = useMegagrindStore()
      store.settings.workCategories = ['dev']
      store.settings.choreCategories = ['laundry']
      const entry = { id: 'w', type: 'work' as const, start: new Date(2026, 8, 9, 9).getTime(), end: new Date(2026, 8, 9, 10).getTime(), category: 'dev' }
      const wrapper = mount(ManualEntryDialog, { props: { type: 'work', show: true, entry, activities: ['work', 'chores', 'sleep'] } })
      const options = () => wrapper.findAll('[data-test="category-select"] option').map((o) => o.attributes('value'))
      expect(options()).toEqual(['', 'dev'])
      await wrapper.find('[data-test="type-select"]').setValue('chores')
      expect(options()).toEqual(['', 'laundry'])
      await wrapper.find('[data-test="type-select"]').setValue('sleep')
      expect(wrapper.find('[data-test="category-select"]').exists()).toBe(false)
    })

    it('keeps a historical category on description-only editing even if settings no longer list it', () => {
      const store = useMegagrindStore()
      store.settings.workCategories = ['dev']
      const entry = { id: 'h', type: 'work' as const, start: new Date(2026, 8, 9, 9).getTime(), end: new Date(2026, 8, 9, 10).getTime(), category: 'retired' }
      const wrapper = mount(ManualEntryDialog, { props: { type: 'work', show: true, entry, activities: ['work'] } })
      expect((wrapper.find('[data-test="category-select"]').element as HTMLSelectElement).value).toBe('retired')
    })

    it('a confirmed overlap does not authorize a widened interval that overlaps another entry', async () => {
      const store = useMegagrindStore()
      store.entries.push({ id: 'a', type: 'move', start: new Date(2026, 8, 9, 9).getTime(), end: new Date(2026, 8, 9, 10).getTime() })
      const wrapper = mount(ManualEntryDialog, { props: { type: 'work', show: true } })
      await wrapper.find('[data-test="start-input"]').setValue('2026-09-09T09:30')
      await wrapper.find('[data-test="end-input"]').setValue('2026-09-09T10:30')
      await wrapper.find('[data-test="confirm-overlap"]').setValue(true)
      store.entries.push({ id: 'b', type: 'sleep', start: new Date(2026, 8, 9, 11).getTime(), end: new Date(2026, 8, 9, 11, 30).getTime() })
      await wrapper.find('[data-test="end-input"]').setValue('2026-09-09T11:15')
      expect((wrapper.find('[data-test="confirm-overlap"]').element as HTMLInputElement).checked).toBe(false)
      expect(wrapper.find('[data-test="save-entry"]').attributes('disabled')).toBeDefined()
    })

    it('idle time counts as recorded time in the overlap preview', async () => {
      const store = useMegagrindStore()
      store.entries.push({ id: 'idle', type: 'idle', start: new Date(2026, 8, 9, 9).getTime(), end: new Date(2026, 8, 9, 10).getTime() })
      const wrapper = mount(ManualEntryDialog, { props: { type: 'work', show: true } })
      await wrapper.find('[data-test="start-input"]').setValue('2026-09-09T09:30')
      await wrapper.find('[data-test="end-input"]').setValue('2026-09-09T10:30')
      expect(wrapper.find('[data-test="overlap-preview"]').text()).toContain('Idle')
    })

    it('reports dirty state and associates field errors with their inputs', async () => {
      const wrapper = mount(ManualEntryDialog, { props: { type: 'work', show: true } })
      expect(wrapper.find('[data-test="start-input"]').attributes('aria-invalid')).toBeUndefined()
      expect(wrapper.find('.field-help').exists()).toBe(true)
      await wrapper.find('[data-test="description-input"]').setValue('x')
      expect(wrapper.emitted('dirty')).toEqual([[true]])
      await wrapper.find('[data-test="end-input"]').setValue('2026-09-09T18:00')
      const endInput = wrapper.find('[data-test="end-input"]')
      expect(endInput.attributes('aria-invalid')).toBe('true')
      const describedBy = endInput.attributes('aria-describedby')!
      expect(wrapper.find(`[id="${describedBy}"]`).text()).toContain('End cannot be in the future.')
    })

    it('every aria-describedby target exists in the initial, invalid, valid and signed states', async () => {
      const described = (wrapper: ReturnType<typeof mount>) =>
        ['start-input', 'end-input'].map((k) => wrapper.find(`[data-test="${k}"]`).attributes('aria-describedby')!)
      const targetExists = (wrapper: ReturnType<typeof mount>) =>
        described(wrapper).every((id) => wrapper.find(`[id="${id}"]`).exists())

      const wrapper = mount(ManualEntryDialog, { props: { type: 'work', show: true } })
      expect(targetExists(wrapper)).toBe(true)

      await wrapper.find('[data-test="end-input"]').setValue('2026-09-09T18:00')
      expect(targetExists(wrapper)).toBe(true)

      await wrapper.find('[data-test="start-input"]').setValue('2026-09-09T09:00')
      await wrapper.find('[data-test="end-input"]').setValue('2026-09-09T11:00')
      expect(targetExists(wrapper)).toBe(true)

      const entry = { id: 'adj', type: 'work' as const, start: new Date(2026, 8, 9, 12).getTime(), end: new Date(2026, 8, 9, 11).getTime(), isCorrection: true, balancedWith: 'x' }
      const signed = mount(ManualEntryDialog, { props: { type: 'work', show: true, entry } })
      expect(targetExists(signed)).toBe(true)
      expect(described(signed)).toEqual([expect.stringContaining('-note'), expect.stringContaining('-note')])
    })
  })
})
