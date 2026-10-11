import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import AppNav from './AppNav.vue'
import { routes } from '../router'

async function mountWithRouter(path = '/') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes,
  })
  router.push(path)
  await router.isReady()
  const wrapper = mount(AppNav, {
    global: { plugins: [router] },
  })
  return { wrapper, router }
}

describe('AppNav', () => {
  it('renders links to all four routes inside a labeled navigation', async () => {
    const { wrapper } = await mountWithRouter()
    const hrefs = wrapper.findAll('a').map((a) => a.attributes('href'))
    expect(hrefs).toEqual(['/', '/dashboard', '/history', '/settings'])
    expect(wrapper.find('nav').attributes('aria-label')).toBe('Primary')
  })

  it('labels the destinations Today, Insights, History and Settings', async () => {
    const { wrapper } = await mountWithRouter()
    const labels = wrapper.findAll('.app-nav-label').map((el) => el.text())
    expect(labels).toEqual(['Today', 'Insights', 'History', 'Settings'])
  })

  it('marks the current destination with aria-current', async () => {
    const { wrapper } = await mountWithRouter('/history')
    const current = wrapper.findAll('a').filter((a) => a.attributes('aria-current') === 'page')
    expect(current).toHaveLength(1)
    expect(current[0]!.attributes('href')).toBe('/history')
  })
})
