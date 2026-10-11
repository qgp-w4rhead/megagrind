import { describe, it, expect, afterEach } from 'vitest'
import { createApp } from 'vue'
import { createPinia, disposePinia, setActivePinia, type Pinia } from 'pinia'
import { megagrindPersistencePlugin } from './persistencePlugin'
import { useMegagrindStore } from './megagrind'
import { DEFAULT_SETTINGS } from '../types'
import type { Settings, TimeEntry } from '../types'

let extraPinia: Pinia | undefined

function partialSettings(): Settings {
  return {
    backendMode: 'local',
    backendUrl: '',
    darkMode: 'dark',
    progressCheckEnabled: true,
  } as unknown as Settings
}

afterEach(() => {
  if (extraPinia) {
    disposePinia(extraPinia)
    extraPinia = undefined
  }
})

describe('partial settings migration', () => {
  it('a partial legacy settings object migrates without crashing and keeps entries', () => {
    const store = useMegagrindStore()
    const entry: TimeEntry = { id: 'keep', type: 'work', start: 1000, end: 2000 }
    store.entries.push(entry)
    store.settings = partialSettings()
    expect(() => store.migrateSettings()).not.toThrow()
    expect(store.entries).toEqual([entry])
    expect(store.settings.weeklyAllocations).toEqual(DEFAULT_SETTINGS.weeklyAllocations)
    expect(store.settings.weeklyAllocations).not.toBe(DEFAULT_SETTINGS.weeklyAllocations)
    expect(store.settings.backendMode).toBe('local')
    expect(store.settings.backendUrl).toBe('')
  })

  it('a partial settings cache restored before hydration does not crash and keeps entries', () => {
    const entry: TimeEntry = { id: 'cached', type: 'sleep', start: 3000, end: 4000 }
    localStorage.setItem('megagrind-store', JSON.stringify({ entries: [entry], settings: { ...partialSettings(), darkMode: 'light' } }))
    extraPinia = createPinia()
    extraPinia.use(megagrindPersistencePlugin)
    // Plugins registered via pinia.use() are staged in toBeInstalled and only
    // moved into _p when pinia is installed into an app — without this the
    // persistedstate plugin never attaches in tests.
    createApp({ template: '<div />' }).use(extraPinia)
    setActivePinia(extraPinia)
    const store = useMegagrindStore()
    expect(store.entries).toEqual([entry])
    expect(store.settings.darkMode).toBe('light')
    expect(store.settings.weeklyAllocations).toEqual(DEFAULT_SETTINGS.weeklyAllocations)
  })

  it('legacy laundry and dishes fold into chores; unknown budget keys survive; the input is not mutated', () => {
    const store = useMegagrindStore()
    const legacy = { sleep: 49, laundry: 0, dishes: 0, meditation: 4 }
    store.settings = { ...partialSettings(), weeklyAllocations: { ...legacy } }
    store.migrateSettings()
    expect(store.settings.weeklyAllocations.chores).toBe(0)
    expect(store.settings.weeklyAllocations.meditation).toBe(4)
    expect(store.settings.weeklyAllocations.sleep).toBe(49)
    expect(store.settings.weeklyAllocations).not.toHaveProperty('laundry')
    expect(store.settings.weeklyAllocations).not.toHaveProperty('dishes')
    expect(legacy).toEqual({ sleep: 49, laundry: 0, dishes: 0, meditation: 4 })
  })
})
