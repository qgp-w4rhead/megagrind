import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import AppNav from './AppNav.vue'
import { routes } from '../router'

function mountWithRouter() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes,
  })
  return mount(AppNav, {
    global: { plugins: [router] },
  })
}

describe('AppNav', () => {
  it('renders links to all four routes', () => {
    const wrapper = mountWithRouter()
    const hrefs = wrapper.findAll('a').map((a) => a.attributes('href'))
    expect(hrefs).toContain('/')
    expect(hrefs).toContain('/dashboard')
    expect(hrefs).toContain('/history')
    expect(hrefs).toContain('/settings')
  })

  it('labels the destinations', () => {
    const wrapper = mountWithRouter()
    const text = wrapper.text()
    expect(text).toMatch(/track/i)
    expect(text).toMatch(/dashboard/i)
    expect(text).toMatch(/history/i)
    expect(text).toMatch(/settings/i)
  })
})
