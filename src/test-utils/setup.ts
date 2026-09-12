import { beforeEach } from 'vitest'
import { createApp } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'

beforeEach(() => {
  localStorage.clear()
  const pinia = createPinia()
  pinia.use(piniaPluginPersistedstate)
  // Plugins registered via pinia.use() are staged in toBeInstalled and only
  // moved into _p when pinia is installed into an app — without this the
  // persistedstate plugin never attaches in tests.
  createApp({ template: '<div />' }).use(pinia)
  setActivePinia(pinia)
})
