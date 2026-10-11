import { beforeEach, afterEach } from 'vitest'
import { createApp } from 'vue'
import { createPinia, disposePinia, setActivePinia, type Pinia } from 'pinia'
import { megagrindPersistencePlugin } from '../stores/persistencePlugin'

let pinia: Pinia | undefined

beforeEach(() => {
  localStorage.clear()
  pinia = createPinia()
  pinia.use(megagrindPersistencePlugin)
  // Plugins registered via pinia.use() are staged in toBeInstalled and only
  // moved into _p when pinia is installed into an app — without this the
  // persistedstate plugin never attaches in tests.
  createApp({ template: '<div />' }).use(pinia)
  setActivePinia(pinia)
})

afterEach(() => {
  if (pinia) disposePinia(pinia)
})
