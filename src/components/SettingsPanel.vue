<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useMegagrindStore } from '../stores/megagrind'
import { useApi, type DatabaseType } from '../composables/useApi'
import { DEFAULT_CHORE_CATEGORIES, DEFAULT_WORK_CATEGORIES } from '../types'
import { X, Download, Upload, Trash2, Plus } from 'lucide-vue-next'

const props = defineProps<{
  show: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const store = useMegagrindStore()
const api = useApi()
const localSettings = ref({
  ...store.settings,
  choreCategories: [...(store.settings.choreCategories ?? DEFAULT_CHORE_CATEGORIES)],
  workCategories: [...(store.settings.workCategories ?? DEFAULT_WORK_CATEGORIES)],
  customChronos: [...(store.settings.customChronos ?? [])],
  weeklyAllocations: { ...store.settings.weeklyAllocations },
})
const newChoreCategory = ref('')
const newWorkCategory = ref('')
const newCustomChrono = ref('')

const hasChanges = computed(() => {
  if (hasInvalidAllocations.value) return false
  return JSON.stringify(localSettings.value) !== JSON.stringify(store.settings)
})

const hasInvalidAllocations = computed(() => {
  return Object.values(localSettings.value.weeklyAllocations).some(
    (val: any) => val === null || val === undefined || val === '' || (typeof val === 'number' && isNaN(val))
  )
})

function addChoreCategory() {
  const val = newChoreCategory.value.trim().toLowerCase()
  if (!val || localSettings.value.choreCategories.includes(val)) return
  localSettings.value.choreCategories.push(val)
  newChoreCategory.value = ''
}

function removeChoreCategory(cat: string, event?: MouseEvent) {
  if (!event?.shiftKey) {
    const label = cat.charAt(0).toUpperCase() + cat.slice(1)
    if (!confirm(`Remove chore type "${label}"?\n\nHold Shift while clicking to skip this confirmation.`)) {
      return
    }
  }
  localSettings.value.choreCategories = localSettings.value.choreCategories.filter((c) => c !== cat)
}

function addWorkCategory() {
  const val = newWorkCategory.value.trim().toLowerCase()
  if (!val || localSettings.value.workCategories.includes(val)) return
  localSettings.value.workCategories.push(val)
  newWorkCategory.value = ''
}

function removeWorkCategory(cat: string, event?: MouseEvent) {
  if (!event?.shiftKey) {
    const label = cat.charAt(0).toUpperCase() + cat.slice(1)
    if (!confirm(`Remove work type "${label}"?\n\nHold Shift while clicking to skip this confirmation.`)) {
      return
    }
  }
  localSettings.value.workCategories = localSettings.value.workCategories.filter((c) => c !== cat)
}

function addCustomChrono() {
  const val = newCustomChrono.value.trim().toLowerCase()
  if (!val || localSettings.value.customChronos.includes(val)) return
  const reservedKeys = ['sleep', 'cook', 'shower', 'chores', 'move', 'leisure', 'unexpected', 'buffer', 'idle', 'work']
  if (reservedKeys.includes(val)) {
    alert('This name is reserved for built-in chronos.')
    return
  }
  localSettings.value.customChronos.push(val)
  localSettings.value.weeklyAllocations[val] = 0
  newCustomChrono.value = ''
}

function removeCustomChrono(chrono: string, event?: MouseEvent) {
  if (!event?.shiftKey) {
    const label = chrono.charAt(0).toUpperCase() + chrono.slice(1)
    if (!confirm(`Remove custom chrono "${label}"?\n\nHold Shift while clicking to skip this confirmation.`)) {
      return
    }
  }
  localSettings.value.customChronos = localSettings.value.customChronos.filter((c) => c !== chrono)
  delete localSettings.value.weeklyAllocations[chrono]
}

const connectionStatus = ref<'idle' | 'testing' | 'connected' | 'failed'>('idle')

watch(() => props.show, (isOpen) => {
  if (isOpen) {
    localSettings.value = {
      ...store.settings,
      choreCategories: [...(store.settings.choreCategories ?? DEFAULT_CHORE_CATEGORIES)],
      workCategories: [...(store.settings.workCategories ?? DEFAULT_WORK_CATEGORIES)],
      customChronos: [...(store.settings.customChronos ?? [])],
      weeklyAllocations: { ...store.settings.weeklyAllocations },
    }
  }
})
const activeDb = ref<DatabaseType | null>(null)
const dbSwitching = ref(false)

async function testConnection() {
  connectionStatus.value = 'testing'
  api.setBaseUrl(localSettings.value.backendUrl)
  try {
    const ok = await api.checkConnection()
    connectionStatus.value = ok ? 'connected' : 'failed'
    if (ok) {
      const status = await api.getDbStatus()
      activeDb.value = status.active
    }
  } catch {
    connectionStatus.value = 'failed'
  }
}

async function switchDatabase(type: DatabaseType) {
  dbSwitching.value = true
  api.setBaseUrl(localSettings.value.backendUrl)
  try {
    const status = await api.switchDatabase(type)
    activeDb.value = status.active
  } catch (err) {
    console.warn('[settings] Failed to switch database', err)
  } finally {
    dbSwitching.value = false
  }
}

function saveSettings() {
  store.updateSettings(localSettings.value)
  emit('close')
}

function exportData() {
  const data = store.exportWeekData()
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `megagrind-week-${new Date().toISOString().split('T')[0]}.json`
  a.click()
  URL.revokeObjectURL(url)
}

function importData() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json'
  input.onchange = (e) => {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target?.result as string)
          store.importWeekData(data)
          localSettings.value = { ...store.settings }
          emit('close')
        } catch (err) {
          alert('Invalid file format')
        }
      }
      reader.readAsText(file)
    }
  }
  input.click()
}

function clearAllData() {
  if (confirm('Are you sure you want to clear all data? This cannot be undone.')) {
    store.updateSettings({ ...store.settings })
    emit('close')
  }
}
</script>

<template>
  <div v-if="show" class="settings-overlay">
    <div class="settings-panel">
      <div class="settings-header">
        <h2>Settings</h2>
        <div v-if="hasChanges" class="unsaved-indicator">Unsaved changes</div>
        <button class="close-btn" @click="emit('close')">
          <X class="close-icon" />
        </button>
      </div>

      <div class="settings-content">
        <div class="settings-section">
          <h3>Weekly Allocations (hours)</h3>
          <div class="allocation-grid">
            <div class="allocation-item">
              <label>Sleep</label>
              <input
                v-model.number="localSettings.weeklyAllocations.sleep"
                type="number"
                step="0.1"
                min="0"
                max="168"
              />
            </div>
            <div class="allocation-item">
              <label>Cook/Eat</label>
              <input
                v-model.number="localSettings.weeklyAllocations.cook"
                type="number"
                step="0.1"
                min="0"
                max="168"
              />
            </div>
            <div class="allocation-item">
              <label>Shower</label>
              <input
                v-model.number="localSettings.weeklyAllocations.shower"
                type="number"
                step="0.1"
                min="0"
                max="168"
              />
            </div>
            <div class="allocation-item">
              <label>Chores</label>
              <input
                v-model.number="localSettings.weeklyAllocations.chores"
                type="number"
                step="0.1"
                min="0"
                max="168"
              />
            </div>
            <div class="allocation-item">
              <label>Move</label>
              <input
                v-model.number="localSettings.weeklyAllocations.move"
                type="number"
                step="0.1"
                min="0"
                max="168"
              />
            </div>
            <div class="allocation-item">
              <label>Leisure</label>
              <input
                v-model.number="localSettings.weeklyAllocations.leisure"
                type="number"
                step="0.1"
                min="0"
                max="168"
              />
            </div>
            <div class="allocation-item">
              <label>Unexpected</label>
              <input
                v-model.number="localSettings.weeklyAllocations.unexpected"
                type="number"
                step="0.1"
                min="0"
                max="168"
              />
            </div>
            <div class="allocation-item">
              <label>Buffer</label>
              <input
                v-model.number="localSettings.weeklyAllocations.buffer"
                type="number"
                step="0.1"
                min="0"
                max="168"
              />
            </div>
            <div v-for="chrono in localSettings.customChronos" :key="chrono" class="allocation-item">
              <label>{{ chrono.charAt(0).toUpperCase() + chrono.slice(1) }}</label>
              <input
                v-model.number="localSettings.weeklyAllocations[chrono]"
                type="number"
                step="0.1"
                min="0"
                max="168"
              />
            </div>
          </div>

          <div class="allocation-subsection">
            <h4>Add Custom Chronos</h4>
            <div class="category-list">
              <div v-for="chrono in localSettings.customChronos" :key="chrono" class="category-tag">
                <span>{{ chrono.charAt(0).toUpperCase() + chrono.slice(1) }}</span>
                <button class="tag-remove" @click="removeCustomChrono(chrono, $event)" title="Remove (hold Shift to skip confirmation)">
                  <X class="tag-remove-icon" />
                </button>
              </div>
            </div>
            <div class="category-add-row">
              <input
                v-model="newCustomChrono"
                type="text"
                placeholder="New chrono (e.g. meditation)"
                class="category-add-input"
                @keyup.enter="addCustomChrono"
              />
              <button class="btn-add-category" @click="addCustomChrono">
                <Plus class="btn-add-icon" />
                Add
              </button>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <h3>Chore Sub-types</h3>
          <div class="category-list">
            <div v-for="cat in localSettings.choreCategories" :key="cat" class="category-tag">
              <span>{{ cat.charAt(0).toUpperCase() + cat.slice(1) }}</span>
              <button class="tag-remove" @click="removeChoreCategory(cat, $event)" title="Remove (hold Shift to skip confirmation)">
                <X class="tag-remove-icon" />
              </button>
            </div>
          </div>
          <div class="category-add-row">
            <input
              v-model="newChoreCategory"
              type="text"
              placeholder="New chore type (e.g. vacuuming)"
              class="category-add-input"
              @keyup.enter="addChoreCategory"
            />
            <button class="btn-add-category" @click="addChoreCategory">
              <Plus class="btn-add-icon" />
              Add
            </button>
          </div>
        </div>

        <div class="settings-section">
          <h3>Work Sub-types</h3>
          <div class="category-list">
            <div v-for="cat in localSettings.workCategories" :key="cat" class="category-tag">
              <span>{{ cat.charAt(0).toUpperCase() + cat.slice(1) }}</span>
              <button class="tag-remove" @click="removeWorkCategory(cat, $event)" title="Remove (hold Shift to skip confirmation)">
                <X class="tag-remove-icon" />
              </button>
            </div>
          </div>
          <div class="category-add-row">
            <input
              v-model="newWorkCategory"
              type="text"
              placeholder="New work type (e.g. design)"
              class="category-add-input"
              @keyup.enter="addWorkCategory"
            />
            <button class="btn-add-category" @click="addWorkCategory">
              <Plus class="btn-add-icon" />
              Add
            </button>
          </div>
        </div>

        <div class="settings-section">
          <h3>Week Rollover</h3>
          <div class="rollover-settings">
            <div class="rollover-item">
              <label>Day</label>
              <select v-model.number="localSettings.weekRolloverDay">
                <option :value="0">Sunday</option>
                <option :value="1">Monday</option>
                <option :value="2">Tuesday</option>
                <option :value="3">Wednesday</option>
                <option :value="4">Thursday</option>
                <option :value="5">Friday</option>
                <option :value="6">Saturday</option>
              </select>
            </div>
            <div class="rollover-item">
              <label title="The hour when your tracking week starts (0-23)">Hour</label>
              <input
                v-model.number="localSettings.weekRolloverHour"
                type="number"
                min="0"
                max="23"
              />
            </div>
          </div>
        </div>

        <div class="settings-section">
          <h3>Notifications</h3>
          <div class="toggle-item">
            <label>Browser notifications</label>
            <input
              v-model="localSettings.notificationsEnabled"
              type="checkbox"
            />
          </div>
          <div class="toggle-item">
            <label>Sound alerts</label>
            <input
              v-model="localSettings.soundEnabled"
              type="checkbox"
            />
          </div>
        </div>

        <div class="settings-section">
          <h3>Progress Check</h3>
          <div class="subsection">
            <h4>Focus Mode</h4>
            <div class="focus-setting">
              <label>Duration (minutes)</label>
              <input
                v-model.number="localSettings.focusModeDuration"
                type="number"
                min="15"
                max="180"
                step="15"
              />
            </div>
          </div>
          <div class="subsection">
            <h4>Check Interval</h4>
            <div class="focus-setting">
              <label>Interval (minutes)</label>
              <input
                v-model.number="localSettings.progressCheckInterval"
                type="number"
                min="5"
                max="60"
                step="5"
              />
            </div>
          </div>
        </div>

        <div class="settings-section">
          <h3>Appearance</h3>
          <div class="appearance-setting">
            <label>Theme</label>
            <select v-model="localSettings.darkMode">
              <option value="auto">Auto</option>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </div>
        </div>

        <div class="settings-section">
          <h3>Data Storage</h3>
          <div class="storage-mode">
            <label>Storage Mode</label>
            <div class="mode-options">
              <label class="mode-option">
                <input
                  v-model="localSettings.backendMode"
                  type="radio"
                  value="local"
                />
                <span>Local (Browser)</span>
              </label>
              <label class="mode-option">
                <input
                  v-model="localSettings.backendMode"
                  type="radio"
                  value="sqlite"
                />
                <span>SQLite (Server)</span>
              </label>
              <label class="mode-option">
                <input
                  v-model="localSettings.backendMode"
                  type="radio"
                  value="mongodb"
                />
                <span>MongoDB (Server)</span>
              </label>
            </div>
          </div>

          <div v-if="localSettings.backendMode !== 'local'" class="backend-config">
            <div class="backend-url-row">
              <div class="backend-url-input">
                <label>Backend URL</label>
                <input
                  v-model="localSettings.backendUrl"
                  type="text"
                  placeholder="http://localhost:3000"
                />
              </div>
              <button
                class="btn-test"
                :disabled="connectionStatus === 'testing'"
                @click="testConnection"
              >
                {{ connectionStatus === 'testing' ? 'Testing...' : 'Test Connection' }}
              </button>
            </div>

            <div v-if="connectionStatus === 'connected'" class="connection-info">
              <span class="status-badge status-ok">Connected</span>
              <span v-if="activeDb" class="active-db">Active DB: {{ activeDb }}</span>
            </div>
            <div v-else-if="connectionStatus === 'failed'" class="connection-info">
              <span class="status-badge status-fail">Connection Failed</span>
            </div>

            <div v-if="connectionStatus === 'connected'" class="db-switch-row">
              <label>Switch Database</label>
              <div class="db-switch-buttons">
                <button
                  class="btn-db-switch"
                  :class="{ active: activeDb === 'sqlite' }"
                  :disabled="dbSwitching || activeDb === 'sqlite'"
                  @click="switchDatabase('sqlite')"
                >
                  SQLite
                </button>
                <button
                  class="btn-db-switch"
                  :class="{ active: activeDb === 'mongodb' }"
                  :disabled="dbSwitching || activeDb === 'mongodb'"
                  @click="switchDatabase('mongodb')"
                >
                  MongoDB
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <h3>Data Management</h3>
          <div class="data-actions">
            <button class="btn-export" @click="exportData">
              <Download class="btn-icon" />
              Export Data
            </button>
            <button class="btn-import" @click="importData">
              <Upload class="btn-icon" />
              Import Data
            </button>
            <button class="btn-clear" @click="clearAllData">
              <Trash2 class="btn-icon" />
              Clear All Data
            </button>
          </div>
        </div>
      </div>

      <div class="settings-footer">
        <button class="btn-cancel" @click="emit('close')">Cancel</button>
        <button class="btn-save" :class="{ disabled: !hasChanges || hasInvalidAllocations }" :disabled="!hasChanges || hasInvalidAllocations" @click="saveSettings">Save Settings</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 1rem;
}

.settings-overlay::backdrop {
  background: rgba(0, 0, 0, 0.8);
}

.settings-panel {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  max-width: 600px;
  width: 100%;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
}

.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.5rem;
  border-bottom: 1px solid var(--border-color);
}

.settings-header h2 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-primary);
}

.unsaved-indicator {
  padding: 0.25rem 0.75rem;
  background: transparent;
  border: 1px solid var(--accent-purple);
  border-radius: 20px;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--accent-purple);
}

.close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.5rem;
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  transition: color 0.2s ease;
}

.close-btn:hover {
  color: var(--text-primary);
}

.close-icon {
  width: 20px;
  height: 20px;
}

.settings-content {
  flex: 1;
  overflow-y: auto;
  padding: 1.5rem;
}

.settings-section {
  margin-bottom: 2rem;
}

.settings-section:last-child {
  margin-bottom: 0;
}

.settings-section h3 {
  margin: 0 0 1rem 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--accent-purple);
}

.allocation-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1rem;
}

@media (max-width: 500px) {
  .allocation-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

.allocation-item {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  background-color: var(--bg-tertiary);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='49' viewBox='0 0 28 49'%3E%3Cg fill-rule='evenodd'%3E%3Cg fill='oklch(0.6 0.18 300)' fill-opacity='0.15'%3E%3Cpath d='M13.99 9.25l13 7.5v15l-13 7.5L1 31.75v-15l12.99-7.5zM3 17.9v12.7l10.99 6.34 11-6.35V17.9l-11-6.34L3 17.9zM0 15l12.98-7.5V0h-2v6.35L0 12.69v2.3zm0 18.5L12.98 41v8h-2v-6.85L0 35.81v-2.3zM15 0v7.5L27.99 15H28v-2.31h-.01L17 6.35V0h-2zm0 49v-8l12.99-7.5H28v2.31h-.01L17 42.15V49h-2z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E");
  padding: 0.75rem;
  border-radius: 8px;
}

.allocation-item label {
  font-size: 0.75rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.allocation-item input {
  padding: 0.5rem;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-primary);
  font-size: 0.875rem;
  appearance: textfield;
  -moz-appearance: textfield;
}

.allocation-item input::-webkit-outer-spin-button,
.allocation-item input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.allocation-item input:focus {
  outline: none;
  border-color: var(--accent-purple);
}

.allocation-subsection {
  margin-top: 1.5rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--border-color);
}

.allocation-subsection h4 {
  margin: 0 0 0.75rem 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--accent-purple);
}

.subsection {
  margin-bottom: 1.5rem;
}

.subsection:last-child {
  margin-bottom: 0;
}

.subsection h4 {
  margin: 0 0 0.75rem 0;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
}

.rollover-settings {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1rem;
}

.rollover-item {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.rollover-item label {
  font-size: 0.75rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.rollover-item input,
.rollover-item select {
  padding: 0.5rem;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-primary);
  font-size: 0.875rem;
}

.rollover-item input {
  appearance: textfield;
  -moz-appearance: textfield;
}

.rollover-item input::-webkit-outer-spin-button,
.rollover-item input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.rollover-item input:focus,
.rollover-item select:focus {
  outline: none;
  border-color: var(--accent-purple);
}

.toggle-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 0;
}

.toggle-item label {
  font-size: 0.875rem;
  color: var(--text-primary);
}

.toggle-item input[type="checkbox"] {
  width: 20px;
  height: 20px;
  accent-color: var(--accent-purple);
}

.focus-setting,
.appearance-setting {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.focus-setting label,
.appearance-setting label {
  font-size: 0.75rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.focus-setting input,
.appearance-setting select {
  padding: 0.5rem;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-primary);
  font-size: 0.875rem;
}

.focus-setting input {
  appearance: textfield;
  -moz-appearance: textfield;
}

.focus-setting input::-webkit-outer-spin-button,
.focus-setting input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.focus-setting input:focus,
.appearance-setting select:focus {
  outline: none;
  border-color: var(--accent-purple);
}

.data-actions {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.btn-export,
.btn-import,
.btn-clear {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.75rem;
  border: none;
  border-radius: 8px;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-export {
  background: transparent;
  color: var(--accent-green);
  border: 1px solid var(--accent-green);
}

.btn-export:hover {
  background: var(--accent-green);
  color: var(--bg-primary);
}

.btn-import {
  background: transparent;
  color: var(--accent-purple);
  border: 1px solid var(--accent-purple);
}

.btn-import:hover {
  background: var(--accent-purple);
  color: var(--bg-primary);
}

.btn-clear {
  background: transparent;
  color: var(--accent-red);
  border: 1px solid var(--accent-red);
}

.btn-clear:hover {
  background: var(--accent-red);
  color: var(--bg-primary);
}

.btn-icon {
  width: 16px;
  height: 16px;
}

.settings-footer {
  display: flex;
  gap: 0.75rem;
  padding: 1.5rem;
  border-top: 1px solid #2a2a4e;
}

.btn-cancel,
.btn-save {
  flex: 1;
  padding: 0.875rem;
  border: none;
  border-radius: 8px;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-cancel {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.btn-cancel:hover {
  background: var(--bg-hover);
}

.btn-save {
  background: var(--accent-purple);
  color: var(--bg-primary);
}

.btn-save:hover {
  background: var(--accent-purple-hover);
}

.btn-save.disabled {
  opacity: 0.5;
  cursor: not-allowed;
  background: var(--bg-tertiary);
  color: var(--text-muted);
}

.btn-save.disabled:hover {
  background: var(--bg-tertiary);
}

.storage-mode {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.storage-mode > label {
  font-size: 0.75rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.mode-options {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}

.mode-option {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  cursor: pointer;
  font-size: 0.875rem;
  color: var(--text-primary);
}

.mode-option input[type="radio"] {
  accent-color: var(--accent-purple);
}

.backend-config {
  margin-top: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.backend-url-row {
  display: flex;
  gap: 0.75rem;
  align-items: flex-end;
}

.backend-url-input {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.backend-url-input label {
  font-size: 0.75rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.backend-url-input input {
  padding: 0.5rem;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-primary);
  font-size: 0.875rem;
}

.backend-url-input input:focus {
  outline: none;
  border-color: var(--accent-purple);
}

.btn-test {
  padding: 0.5rem 1rem;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-primary);
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.2s ease;
}

.btn-test:hover:not(:disabled) {
  background: var(--bg-hover);
}

.btn-test:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.connection-info {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.status-badge {
  padding: 0.25rem 0.625rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
}

.status-ok {
  background: var(--accent-green);
  color: var(--bg-primary);
}

.status-fail {
  background: var(--accent-red);
  color: var(--text-primary);
}

.active-db {
  font-size: 0.75rem;
  color: var(--text-muted);
}

.db-switch-row {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.db-switch-row > label {
  font-size: 0.75rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.db-switch-buttons {
  display: flex;
  gap: 0.75rem;
}

.btn-db-switch {
  padding: 0.5rem 1.25rem;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-primary);
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-db-switch:hover:not(:disabled) {
  background: var(--bg-hover);
}

.btn-db-switch.active {
  border-color: var(--accent-purple);
  background: var(--bg-hover);
}

.btn-db-switch:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.category-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.category-list:not(:empty) {
  margin-bottom: 0.75rem;
}

.category-tag {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.25rem 0.5rem 0.25rem 0.75rem;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 20px;
  font-size: 0.8125rem;
  color: var(--text-primary);
}

.tag-remove {
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 0;
  border-radius: 50%;
  transition: color 0.2s ease;
}

.tag-remove:hover {
  color: var(--accent-red);
}

.tag-remove-icon {
  width: 12px;
  height: 12px;
}

.category-add-row {
  display: flex;
  gap: 0.5rem;
}

.category-add-input {
  flex: 1;
  padding: 0.5rem 0.75rem;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-primary);
  font-size: 0.875rem;
}

.category-add-input:focus {
  outline: none;
  border-color: var(--accent-purple);
}

.category-add-input::placeholder {
  color: var(--text-muted);
}

.btn-add-category {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.5rem 0.875rem;
  background: var(--bg-tertiary);
  border: 1px solid var(--accent-purple);
  border-radius: 6px;
  color: var(--accent-purple);
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.2s ease;
}

.btn-add-category:hover {
  background: var(--accent-purple);
  color: var(--bg-primary);
}

.btn-add-icon {
  width: 14px;
  height: 14px;
}
</style>

<style>
body:has(.settings-overlay) {
  overflow: hidden;
}
</style>
