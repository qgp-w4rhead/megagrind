import { onMounted, onBeforeUnmount } from 'vue'

function setLayoutVar(name: string, value: string) {
  document.documentElement.style.setProperty(name, value)
}

export function useShellLayout(root: () => HTMLElement | null) {
  const cleanups: Array<() => void> = []

  onMounted(() => {
    const shell = root()
    if (!shell) return
    const nav = shell.querySelector<HTMLElement>('.app-nav')
    const bar = shell.querySelector<HTMLElement>('.app-now')

    if (typeof ResizeObserver !== 'undefined') {
      const measure = () => {
        if (nav && getComputedStyle(nav).position === 'fixed') {
          setLayoutVar('--bottom-nav-h', `${nav.getBoundingClientRect().height}px`)
        } else {
          setLayoutVar('--bottom-nav-h', '0px')
        }
        if (bar) setLayoutVar('--now-bar-h', `${bar.getBoundingClientRect().height}px`)
      }
      const observer = new ResizeObserver(measure)
      if (nav) observer.observe(nav)
      if (bar) observer.observe(bar)
      measure()
      cleanups.push(() => observer.disconnect())
    }

    const viewport = typeof window !== 'undefined' ? window.visualViewport : null
    if (viewport) {
      const sync = () => {
        setLayoutVar('--vv-height', `${viewport.height}px`)
        setLayoutVar('--vv-top', `${viewport.offsetTop ?? 0}px`)
      }
      viewport.addEventListener('resize', sync)
      viewport.addEventListener('scroll', sync)
      sync()
      cleanups.push(() => {
        viewport.removeEventListener('resize', sync)
        viewport.removeEventListener('scroll', sync)
      })
    }
  })

  onBeforeUnmount(() => {
    cleanups.forEach((cleanup) => cleanup())
  })
}
