import { describe, it, expect, vi, afterEach } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { useShellLayout } from './useShellLayout'

function shellComponent() {
  return defineComponent({
    setup() {
      const root = ref<HTMLElement | null>(null)
      useShellLayout(() => root.value)
      return () => h('div', { ref: root, class: 'shell' }, [h('div', { class: 'app-now' }), h('nav', { class: 'app-nav' })])
    },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useShellLayout', () => {
  it('mounts and unmounts safely where ResizeObserver and visualViewport are unavailable', () => {
    vi.stubGlobal('ResizeObserver', undefined)
    const wrapper = mount(shellComponent())
    expect(() => wrapper.unmount()).not.toThrow()
  })

  it('disconnects the observer and removes viewport listeners on unmount', () => {
    const disconnect = vi.fn()
    class FakeObserver {
      observe = vi.fn()
      disconnect = disconnect
      constructor(_cb: unknown) {}
    }
    vi.stubGlobal('ResizeObserver', FakeObserver)
    const viewport = new EventTarget() as EventTarget & { height: number }
    viewport.height = 600
    vi.stubGlobal('visualViewport', viewport)
    const removeSpy = vi.spyOn(viewport, 'removeEventListener')
    const wrapper = mount(shellComponent())
    wrapper.unmount()
    expect(disconnect).toHaveBeenCalledTimes(1)
    expect(removeSpy).toHaveBeenCalledWith('resize', expect.any(Function))
    expect(removeSpy).toHaveBeenCalledWith('scroll', expect.any(Function))
  })

  it('mirrors visible viewport height and offset on resize, and stops after unmount', () => {
    vi.stubGlobal('ResizeObserver', undefined)
    const viewport = new EventTarget() as EventTarget & { height: number; offsetTop: number }
    viewport.height = 600
    viewport.offsetTop = 0
    vi.stubGlobal('visualViewport', viewport)
    const wrapper = mount(shellComponent())
    viewport.height = 380
    viewport.offsetTop = 120
    viewport.dispatchEvent(new Event('resize'))
    expect(document.documentElement.style.getPropertyValue('--vv-height')).toBe('380px')
    expect(document.documentElement.style.getPropertyValue('--vv-top')).toBe('120px')
    wrapper.unmount()
    viewport.height = 200
    viewport.dispatchEvent(new Event('resize'))
    expect(document.documentElement.style.getPropertyValue('--vv-height')).toBe('380px')
  })
})
