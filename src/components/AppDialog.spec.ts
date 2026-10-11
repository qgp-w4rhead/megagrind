import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import AppDialog from './AppDialog.vue'

describe('AppDialog', () => {
  it('renders the title and body and labels the dialog by its title', () => {
    const wrapper = mount(AppDialog, { props: { show: true, title: 'Edit entry' }, slots: { default: '<p>Body</p>' } })
    const dialog = wrapper.find('dialog')
    expect(wrapper.find('h2').text()).toBe('Edit entry')
    expect(dialog.attributes('aria-labelledby')).toBe(wrapper.find('h2').attributes('id'))
    expect(wrapper.text()).toContain('Body')
  })

  it('emits close from its Close button and from Escape', async () => {
    const wrapper = mount(AppDialog, { props: { show: true, title: 'Delete entry?' } })
    await wrapper.find('[data-test="close-button"], .app-dialog-close').trigger('click')
    await wrapper.find('dialog').trigger('cancel')
    expect(wrapper.emitted('close')).toHaveLength(2)
  })

  it('a non-dismissible dialog has no close button and ignores Escape', async () => {
    const wrapper = mount(AppDialog, { props: { show: true, title: 'Progress Check', dismissible: false } })
    expect(wrapper.find('.app-dialog-close').exists()).toBe(false)
    await wrapper.find('dialog').trigger('cancel')
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('opens and returns focus to the element that opened it', async () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const wrapper = mount(AppDialog, { props: { show: false, title: 'All activities' }, attachTo: document.body })
    await wrapper.setProps({ show: true })
    await nextTick()
    expect(wrapper.find('dialog').attributes('open')).toBeDefined()
    await wrapper.setProps({ show: false })
    await nextTick()
    expect(wrapper.find('dialog').attributes('open')).toBeUndefined()
    expect(document.activeElement).toBe(opener)
    wrapper.unmount()
    opener.remove()
  })
})
