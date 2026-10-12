<script setup lang="ts">
import { ref, computed, useId } from 'vue'
import { useRouter, onBeforeRouteLeave } from 'vue-router'
import { useMegagrindStore } from '../stores/megagrind'
import { useApi, type DatabaseType } from '../composables/useApi'
import { buildDefaultActivities, DEFAULT_CHORE_CATEGORIES, DEFAULT_WORK_CATEGORIES, type Goal } from '../types'
import { endpointIdFor, validateBackendUrl } from '../domain/sync'
import { listRecoveryKeys, recoveryBytes } from '../domain/backup'
import { downloadRecoveryCopy } from '../stores/persistencePlugin'
import { pwa, promptInstall } from '../pwa/pwa'
import { validateSettings, hasSettingsErrors } from '../domain/settingsValidation'
import { activityDefinitions } from '../domain/activities'
import { goalCapacity, validateGoals, type GoalPolicy } from '../domain/goals'
import { X, Trash2, Plus } from 'lucide-vue-next'
import BackupPanel from './BackupPanel.vue'

const router = useRouter()
function close() {
  router.push('/')
}

const store = useMegagrindStore()
const api = useApi()
const localSettings = ref({
  ...store.settings,
  choreCategories: [...(store.settings.choreCategories ?? DEFAULT_CHORE_CATEGORIES)],
  workCategories: [...(store.settings.workCategories ?? DEFAULT_WORK_CATEGORIES)],
  customChronos: [...(store.settings.customChronos ?? [])],
  weeklyAllocations: { ...store.settings.weeklyAllocations },
  activities: (store.settings.activities ?? buildDefaultActivities()).map((a) => ({ ...a })),
  goals: JSON.parse(JSON.stringify(store.settings.goals ?? {})) as Record<string, Goal>,
})
const allocPrefix = useId()
const newChoreCategory = ref('')
const newWorkCategory = ref('')
const newCustomChrono = ref('')

const isDirty = computed(() => JSON.stringify(localSettings.value) !== JSON.stringify(store.settings))

const validationErrors = computed(() => validateSettings(localSettings.value))
const backendUrlError = computed(() => {
  if (localSettings.value.backendMode === 'local') return null
  const protocol = typeof window !== 'undefined' ? window.location.protocol : 'http:'
  return validateBackendUrl(localSettings.value.backendUrl, protocol)
})
// Activities & goals: rows are the merged definitions (built-ins, customs,
// history-only types); goals live per activity id in the draft until Save.
const goalRows = computed(() =>
  activityDefinitions(localSettings.value.customChronos, store.entries.map((e) => e.type), localSettings.value.activities),
)
const goalErrors = computed(() => validateGoals(localSettings.value.goals))
const goalCap = computed(() => goalCapacity(localSettings.value.goals))

function goalPolicyOf(id: string): GoalPolicy {
  return localSettings.value.goals[id]?.policy ?? 'none'
}
function goalHoursOf(id: string): number | string {
  return localSettings.value.goals[id]?.hours ?? ''
}
function setGoalPolicy(id: string, policy: string) {
  const goals = { ...localSettings.value.goals }
  if (policy === 'none') delete goals[id]
  else goals[id] = { policy: policy as Goal['policy'], hours: goals[id]?.hours ?? 0 }
  localSettings.value.goals = goals
}
function setGoalHours(id: string, hours: number | null) {
  const existing = localSettings.value.goals[id]
  if (!existing) return
  localSettings.value.goals = { ...localSettings.value.goals, [id]: { ...existing, hours: hours ?? NaN } }
}
// Materialize synthesized definitions (custom/history-only types) into the
// draft so every row edits the same stable activity ids before Save.
function materializeActivities() {
  localSettings.value.activities = activityDefinitions(
    localSettings.value.customChronos,
    store.entries.map((e) => e.type),
    localSettings.value.activities,
  )
}
function setActivityLabel(id: string, label: string) {
  materializeActivities()
  localSettings.value.activities = localSettings.value.activities.map((a) =>
    a.id === id ? { ...a, label } : a,
  )
}
function toggleArchived(id: string) {
  materializeActivities()
  localSettings.value.activities = localSettings.value.activities.map((a) =>
    a.id === id ? { ...a, archived: !a.archived } : a,
  )
}
function moveActivity(id: string, dir: -1 | 1) {
  materializeActivities()
  const defs = localSettings.value.activities.map((a) => ({ ...a }))
  const idx = defs.findIndex((d) => d.id === id)
  const swap = idx + dir
  if (idx < 0 || swap < 0 || swap >= defs.length) return
  const order = defs[idx]!.order
  defs[idx]!.order = defs[swap]!.order
  defs[swap]!.order = order
  localSettings.value.activities = defs
}
function toggleFavorite(id: string) {
  localSettings.value.activities = localSettings.value.activities.map((a) =>
    a.id === id ? { ...a, favorite: !a.favorite } : a,
  )
}
// Reviewable adoption: copies legacy weekly targets into goal policies — the
// draft still needs an explicit Save, and allocations stay untouched.
function adoptAllocations() {
  const goals = { ...localSettings.value.goals }
  for (const [id, hours] of Object.entries(localSettings.value.weeklyAllocations)) {
    if (typeof hours !== 'number' || !Number.isFinite(hours) || hours <= 0) continue
    const policy: Goal['policy'] =
      id === 'work' ? 'target' : id === 'sleep' || id === 'move' ? 'minimum' : id === 'chores' ? 'budget' : 'target'
    goals[id] = { policy, hours }
  }
  localSettings.value.goals = goals
}

const validationMessages = computed(() => {
  const messages = Object.values(validationErrors.value)
  if (backendUrlError.value) messages.push(backendUrlError.value)
  messages.push(...new Set(Object.values(goalErrors.value)))
  if (goalCap.value.overBy > 0) {
    messages.push(`Goals total ${goalCap.value.planned}h — ${goalCap.value.overBy}h over the 168-hour week. Lower or clear a goal to save.`)
  }
  return messages
})

const hasChanges = computed(() => {
  if (hasInvalidAllocations.value) return false
  if (hasSettingsErrors(validationErrors.value)) return false
  if (backendUrlError.value) return false
  if (Object.keys(goalErrors.value).length > 0) return false
  if (goalCap.value.overBy > 0) return false
  return isDirty.value
})

onBeforeRouteLeave((_to, _from, next) => {
  if (!isDirty.value || window.confirm('Discard unsaved settings changes?')) {
    next()
  } else {
    next(false)
  }
})

const hasInvalidAllocations = computed(() => {
  return Object.values(localSettings.value.weeklyAllocations).some(
    (val: unknown) => val === null || val === undefined || val === '' || (typeof val === 'number' && isNaN(val))
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
  const hasHistory = store.entries.some((e) => e.type === chrono)
  if (!event?.shiftKey) {
    const label = chrono.charAt(0).toUpperCase() + chrono.slice(1)
    const detail = hasHistory
      ? 'Past records keep this name, and it stays hidden from new entries.'
      : 'It has no recorded history, so it will be removed completely.'
    if (!confirm(`Remove custom chrono "${label}"?\n\n${detail}\n\nHold Shift while clicking to skip this confirmation.`)) {
      return
    }
  }
  if (hasHistory) {
    // Archive rather than delete: history, filters, backups, and goal mappings
    // keep resolving the stable id.
    localSettings.value.customChronos = localSettings.value.customChronos.filter((c) => c !== chrono)
    materializeActivities()
    localSettings.value.activities = localSettings.value.activities.map((a) =>
      a.id === chrono ? { ...a, archived: true } : a,
    )
    return
  }
  localSettings.value.customChronos = localSettings.value.customChronos.filter((c) => c !== chrono)
  localSettings.value.activities = localSettings.value.activities.filter((a) => a.id !== chrono)
  const goals = { ...localSettings.value.goals }
  delete goals[chrono]
  localSettings.value.goals = goals
  delete localSettings.value.weeklyAllocations[chrono]
}

const connectionStatus = ref<'idle' | 'testing' | 'connected' | 'failed'>('idle')

const activeDb = ref<DatabaseType | null>(null)

async function testConnection() {
  connectionStatus.value = 'testing'
  const candidate = localSettings.value.backendUrl
  try {
    const ok = await api.checkConnection(candidate)
    connectionStatus.value = ok ? 'connected' : 'failed'
    if (ok) {
      const status = await api.getDbStatus(candidate)
      activeDb.value = status.active
    }
  } catch {
    connectionStatus.value = 'failed'
  }
}

const syncActionMessage = ref('')

const lastSyncLabel = computed(() =>
  store.lastSyncedAt === null ? 'never' : new Date(store.lastSyncedAt).toLocaleString(),
)

const syncStatusLabel = computed(() => {
  switch (store.syncStatus) {
    case 'local': return 'Local only'
    case 'offline': return 'Offline — changes are queued on this device'
    case 'pending': return 'Changes waiting to send'
    case 'syncing': return 'Syncing'
    case 'synced': return 'Synced'
    case 'conflict': return 'Conflict needs a decision'
    case 'failed': return 'A change was rejected and needs attention'
    default: return 'Local only'
  }
})

function describeSyncRemote(kind: string): string {
  switch (kind) {
    case 'entry': return 'has a different version'
    case 'tombstone': return 'deleted it'
    case 'preferences': return 'has different preferences'
    default: return 'has no record of it'
  }
}

function adoptForeignOps() {
  const adopted = store.adoptQueuedOpsToCurrentEndpoint()
  syncActionMessage.value =
    adopted > 0
      ? `${adopted} queued change(s) will be sent to this endpoint.`
      : 'No queued changes need reassignment.'
}

function retrySync() {
  syncActionMessage.value = 'Checking the sync endpoint…'
  store.retrySync()
}

function saveSettings() {
  if (!hasChanges.value) return
  const prevMode = store.settings.backendMode
  const prevUrl = store.settings.backendUrl
  const origin = typeof window !== 'undefined' ? window.location.origin : 'same-origin'
  const prevEndpoint = endpointIdFor(prevMode, prevUrl, origin)
  const nextEndpoint = endpointIdFor(localSettings.value.backendMode, localSettings.value.backendUrl, origin)
  if (prevEndpoint !== nextEndpoint) {
    const queued = store.pendingSyncCount + store.foreignSyncCount + store.blockedSyncCount
    const detail =
      queued > 0
        ? `${queued} queued change(s) stay bound to the previous endpoint and will NOT be sent to the new one. You can assign them to the new endpoint in Settings → Data Storage.`
        : 'No queued changes are affected.'
    const proceed = window.confirm(
      `Change the sync endpoint?\n\n${detail}\n\nLocal entries on this device merge into the new endpoint on the next sync.`,
    )
    if (!proceed) return
  }
  store.updateSettings(localSettings.value)
  // If backend config changed, reinitialize so it takes effect without reload.
  if (store.settings.backendMode !== 'local' && prevEndpoint !== nextEndpoint) {
    store.initFromBackend()
  }
  close()
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

const storageUsage = ref<{ used: number; quota: number } | null>(null)
const storageSupported = ref(false)
const recoveryInfo = ref<{ snapshots: number; bytes: number }>({ snapshots: 0, bytes: 0 })

function refreshStorageInfo() {
  try {
    const keys = typeof localStorage === 'undefined' ? [] : listRecoveryKeys(localStorage)
    recoveryInfo.value = {
      snapshots: keys.length,
      bytes: recoveryBytes(localStorage),
    }
  } catch {
    recoveryInfo.value = { snapshots: 0, bytes: 0 }
  }
  storageSupported.value = typeof navigator !== 'undefined' && !!navigator.storage?.estimate
  if (storageSupported.value) {
    navigator.storage.estimate().then((estimate) => {
      storageUsage.value = { used: estimate.usage ?? 0, quota: estimate.quota ?? 0 }
    }).catch(() => {
      storageUsage.value = null
    })
  }
}
refreshStorageInfo()

const storageMessage = ref('')

function downloadSnapshot() {
  storageMessage.value = downloadRecoveryCopy()
    ? 'Recovery copy downloaded.'
    : 'No stored data is available to download.'
}

const installMessage = ref('')

async function installApp() {
  const outcome = await promptInstall()
  installMessage.value =
    outcome === 'accepted'
      ? 'Installed.'
      : outcome === 'dismissed'
        ? 'Install dismissed — the option stays available while the browser offers it.'
        : 'This browser is not offering an install prompt.'
}

function clearAllData() {
  const scope =
    'This clears tracked entries, progress checks, and progress history on this device only.\n\n' +
    'Queued changes waiting for your sync server stay queued. Data already stored on the server is not touched.'
  if (confirm(`Clear local tracking history?\n\n${scope}`)) {
    store.clearLocalHistory()
    close()
  }
}
</script>

<template>
  <div class="settings-view">
    <div class="settings-panel">
      <div class="settings-header">
        <h2>Settings</h2>
        <div class="header-right">
          <span v-if="hasChanges" class="unsaved-indicator">Unsaved changes</span>
          <button class="close-btn" aria-label="Close settings" @click="close">
            <X class="close-icon" />
          </button>
        </div>
      </div>

      <div class="settings-content">
        <div class="settings-section">
          <h3>Weekly Allocations (hours)</h3>
          <div class="allocation-grid">
            <div class="allocation-item">
              <label for="settings-field-1">Sleep</label>
              <input id="settings-field-1"
                v-model.number="localSettings.weeklyAllocations.sleep"
                type="number"
                step="0.1"
                min="0"
                max="168"
              />
            </div>
            <div class="allocation-item">
              <label for="settings-field-2">Cook/Eat</label>
              <input id="settings-field-2"
                v-model.number="localSettings.weeklyAllocations.cook"
                type="number"
                step="0.1"
                min="0"
                max="168"
              />
            </div>
            <div class="allocation-item">
              <label for="settings-field-3">Shower</label>
              <input id="settings-field-3"
                v-model.number="localSettings.weeklyAllocations.shower"
                type="number"
                step="0.1"
                min="0"
                max="168"
              />
            </div>
            <div class="allocation-item">
              <label for="settings-field-4">Chores</label>
              <input id="settings-field-4"
                v-model.number="localSettings.weeklyAllocations.chores"
                type="number"
                step="0.1"
                min="0"
                max="168"
              />
            </div>
            <div class="allocation-item">
              <label for="settings-field-5">Move</label>
              <input id="settings-field-5"
                v-model.number="localSettings.weeklyAllocations.move"
                type="number"
                step="0.1"
                min="0"
                max="168"
              />
            </div>
            <div class="allocation-item">
              <label for="settings-field-6">Leisure</label>
              <input id="settings-field-6"
                v-model.number="localSettings.weeklyAllocations.leisure"
                type="number"
                step="0.1"
                min="0"
                max="168"
              />
            </div>
            <div class="allocation-item">
              <label for="settings-field-7">Unexpected</label>
              <input id="settings-field-7"
                v-model.number="localSettings.weeklyAllocations.unexpected"
                type="number"
                step="0.1"
                min="0"
                max="168"
              />
            </div>
            <div class="allocation-item">
              <label for="settings-field-8">Buffer</label>
              <input id="settings-field-8"
                v-model.number="localSettings.weeklyAllocations.buffer"
                type="number"
                step="0.1"
                min="0"
                max="168"
              />
            </div>
            <div v-for="(chrono, customIndex) in localSettings.customChronos" :key="chrono" class="allocation-item">
              <label :for="`${allocPrefix}-custom-${customIndex}`">{{ chrono.charAt(0).toUpperCase() + chrono.slice(1) }}</label>
              <input :id="`${allocPrefix}-custom-${customIndex}`"
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
                <button class="tag-remove" :aria-label="`Remove ${chrono}`" @click="removeCustomChrono(chrono, $event)" title="Remove (hold Shift to skip confirmation)">
                  <X class="tag-remove-icon" />
                </button>
              </div>
            </div>
            <div class="category-add-row">
              <input
                v-model="newCustomChrono"
                aria-label="Add custom activity"
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

        <div class="settings-section" data-test="goals-section">
          <h3>Activities &amp; goals</h3>
          <p class="field-hint">
            Favorites appear first on Today, and order decides picker placement. Goals are
            optional weekly policies — hours left over stay unplanned. Archiving hides an
            activity from new entries while history keeps its name.
          </p>
          <ul class="goal-list">
            <li v-for="(row, index) in goalRows" :key="row.id" class="goal-row" :class="{ 'is-archived': row.archived }">
              <label class="goal-fav" :title="`Favorite ${row.label}`">
                <input
                  type="checkbox"
                  :checked="row.favorite"
                  :aria-label="`Favorite ${row.label}`"
                  :disabled="row.archived"
                  @change="toggleFavorite(row.id)"
                />
                <span aria-hidden="true">★</span>
              </label>
              <input
                :value="row.label"
                type="text"
                maxlength="60"
                class="goal-name"
                :aria-label="`Display name for ${row.id}`"
                :aria-invalid="row.label.trim().length === 0 ? 'true' : undefined"
                @input="setActivityLabel(row.id, ($event.target as HTMLInputElement).value)"
              />
              <span class="goal-controls">
                <button
                  type="button"
                  class="btn-row"
                  :aria-label="`Move ${row.label} up`"
                  :disabled="index === 0"
                  data-test="activity-up"
                  @click="moveActivity(row.id, -1)"
                >↑</button>
                <button
                  type="button"
                  class="btn-row"
                  :aria-label="`Move ${row.label} down`"
                  :disabled="index === goalRows.length - 1"
                  data-test="activity-down"
                  @click="moveActivity(row.id, 1)"
                >↓</button>
                <button
                  type="button"
                  class="btn-row"
                  :aria-label="row.archived ? `Unarchive ${row.label}` : `Archive ${row.label}`"
                  :data-test="row.archived ? 'activity-unarchive' : 'activity-archive'"
                  @click="toggleArchived(row.id)"
                >{{ row.archived ? 'Unarchive' : 'Archive' }}</button>
              </span>
              <select
                :value="goalPolicyOf(row.id)"
                :aria-label="`Goal type for ${row.label}`"
                @change="setGoalPolicy(row.id, ($event.target as HTMLSelectElement).value)"
              >
                <option value="none">No goal</option>
                <option value="target">Target</option>
                <option value="minimum">Minimum</option>
                <option value="budget">Budget</option>
              </select>
              <input
                v-if="goalPolicyOf(row.id) !== 'none'"
                type="number"
                min="0"
                max="168"
                step="0.5"
                class="goal-hours"
                :value="goalHoursOf(row.id)"
                :aria-label="`Weekly hours for ${row.label}`"
                :aria-invalid="goalErrors[row.id] ? 'true' : undefined"
                @input="setGoalHours(row.id, ($event.target as HTMLInputElement).valueAsNumber)"
              />
            </li>
          </ul>
          <p class="goal-capacity" :class="{ 'is-over': goalCap.overBy > 0 }" data-test="goal-capacity">
            Planned: {{ goalCap.planned }}h of 168h
            <template v-if="goalCap.overBy > 0">— {{ goalCap.overBy }}h over the week.</template>
            <template v-else>— {{ goalCap.free }}h stays unplanned.</template>
          </p>
          <button type="button" class="btn-test" data-test="adopt-allocations" @click="adoptAllocations">
            Use weekly targets as goals
          </button>
          <p class="field-hint">
            Copies the weekly allocations above into goal policies for your review — nothing
            changes until you press Save.
          </p>
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
              aria-label="Add chore type"
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
              aria-label="Add work type"
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
              <label for="settings-field-10">Day</label>
              <select id="settings-field-10" v-model.number="localSettings.weekRolloverDay">
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
              <label title="The hour when your tracking week starts (0-23)" for="settings-field-11">Hour</label>
              <input id="settings-field-11"
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
            <label for="settings-field-12">Browser notifications</label>
            <input id="settings-field-12"
              v-model="localSettings.notificationsEnabled"
              type="checkbox"
            />
          </div>
          <div class="toggle-item">
            <label for="settings-field-13">Sound alerts</label>
            <input id="settings-field-13"
              v-model="localSettings.soundEnabled"
              type="checkbox"
            />
          </div>
          <div class="toggle-item">
            <label for="settings-field-14">Idle time tracking</label>
            <input id="settings-field-14"
              v-model="localSettings.idleTimeEnabled"
              type="checkbox"
            />
          </div>
        </div>

        <div class="settings-section">
          <h3>Progress Check</h3>
          <div class="toggle-item">
            <label for="settings-field-15">Enable progress check</label>
            <input id="settings-field-15"
              v-model="localSettings.progressCheckEnabled"
              type="checkbox"
            />
          </div>
          <div class="subsection">
            <h4>Focus Mode</h4>
            <div class="focus-setting">
              <label for="settings-field-16">Duration (minutes)</label>
              <input id="settings-field-16"
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
              <label for="settings-field-17">Interval (minutes)</label>
              <input id="settings-field-17"
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
            <label for="settings-field-18">Theme</label>
            <select id="settings-field-18" v-model="localSettings.darkMode">
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
                <span>Local on this device</span>
              </label>
              <label class="mode-option">
                <input
                  v-model="localSettings.backendMode"
                  type="radio"
                  value="sqlite"
                />
                <span>Optional private server (SQLite)</span>
              </label>
            </div>
            <p class="storage-status" data-test="storage-status">
              <template v-if="store.settings.backendMode === 'local'">
                Saved on this device only. Tracking works without a server.
              </template>
              <template v-else>
                {{ syncStatusLabel }}.
                {{ store.pendingSyncCount }} waiting<template v-if="store.blockedSyncCount > 0">,
                  {{ store.blockedSyncCount }} need a decision</template><template v-if="store.foreignSyncCount > 0">,
                  {{ store.foreignSyncCount }} bound to a different endpoint</template>.
                Last successful sync: {{ lastSyncLabel }}.
              </template>
            </p>
            <div v-if="store.settings.backendMode !== 'local'" class="sync-actions">
              <button type="button" class="btn-test" data-test="sync-retry" @click="retrySync">
                Retry sync
              </button>
              <button
                v-if="store.foreignSyncCount > 0"
                type="button"
                class="btn-test"
                data-test="sync-adopt"
                @click="adoptForeignOps"
              >
                Send {{ store.foreignSyncCount }} queued change(s) to this endpoint
              </button>
            </div>
            <p v-if="syncActionMessage" class="sync-action-message" role="status">{{ syncActionMessage }}</p>
            <ul v-if="store.syncConflicts.length > 0" class="sync-conflict-list" data-test="sync-conflicts">
              <li v-for="conflict in store.syncConflicts" :key="conflict.resource" class="sync-conflict-item">
                <span class="sync-conflict-text">
                  {{ conflict.label }} — the server {{ describeSyncRemote(conflict.remoteKind) }}
                </span>
                <span class="sync-conflict-buttons">
                  <button
                    type="button"
                    class="btn-test"
                    :data-test="`settings-keep-local-${conflict.resource}`"
                    @click="store.resolveSyncConflict(conflict.resource, 'keep-local')"
                  >
                    Keep mine
                  </button>
                  <button
                    type="button"
                    class="btn-test"
                    :data-test="`settings-keep-remote-${conflict.resource}`"
                    @click="store.resolveSyncConflict(conflict.resource, 'keep-remote')"
                  >
                    Use server's
                  </button>
                </span>
              </li>
            </ul>
            <div class="local-storage" data-test="local-storage">
              <p class="storage-status" data-test="storage-usage">
                <template v-if="storageUsage">
                  This device is using about {{ formatBytes(storageUsage.used) }} of
                  {{ formatBytes(storageUsage.quota) }} browser storage.
                </template>
                <template v-else-if="storageSupported">Reading storage usage…</template>
                <template v-else>Browser storage usage reporting is not available here.</template>
              </p>
              <p class="storage-status" data-test="recovery-snapshots">
                {{ recoveryInfo.snapshots }} recovery snapshot(s), {{ formatBytes(recoveryInfo.bytes) }}.
                Snapshots live in the same browser storage — they help with mistakes, not device loss.
              </p>
              <button type="button" class="btn-test" data-test="download-recovery" @click="downloadSnapshot">
                Download recovery copy
              </button>
              <p v-if="storageMessage" class="sync-action-message" role="status" data-test="storage-message">{{ storageMessage }}</p>
            </div>
          </div>

          <div v-if="localSettings.backendMode !== 'local'" class="backend-config">
            <div class="backend-url-row">
              <div class="backend-url-input">
                <label for="settings-field-19">Backend URL</label>
                <input id="settings-field-19"
                  v-model="localSettings.backendUrl"
                  type="text"
                  placeholder="http://localhost:3000 — empty uses this app’s origin"
                  :aria-invalid="backendUrlError ? 'true' : undefined"
                  :aria-describedby="backendUrlError ? 'backend-url-error' : 'backend-url-hint'"
                />
                <p v-if="backendUrlError" id="backend-url-error" class="field-error" role="alert" data-test="backend-url-error">
                  {{ backendUrlError }}
                </p>
                <p v-else id="backend-url-hint" class="field-hint">
                  Device-only setting — it never syncs and is excluded from backups.
                </p>
              </div>
              <button
                class="btn-test"
                data-test="test-connection"
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

          </div>
        </div>

        <div class="settings-section">
          <h3>Backup and restore</h3>
          <BackupPanel />
        </div>

        <div class="settings-section">
          <h3>Data Management</h3>
          <div class="data-actions">
            <button class="btn-clear" @click="clearAllData">
              <Trash2 class="btn-icon" />
              Clear local tracking history
            </button>
          </div>
        </div>

        <div class="settings-section" data-test="install-section">
          <h3>Install this app</h3>
          <p v-if="pwa.capability === 'installed'" class="field-hint" data-test="install-installed">
            MegaGrind is installed and running as an app.
          </p>
          <template v-else-if="pwa.capability === 'installable'">
            <div class="data-actions">
              <button type="button" class="btn-action" data-test="install-app" @click="installApp">
                Install MegaGrind
              </button>
            </div>
            <p class="field-hint">
              Adds an app icon and a standalone window. Tracking works the same either way.
            </p>
          </template>
          <p v-else-if="pwa.capability === 'ios-manual'" class="field-hint" data-test="install-ios">
            On iPhone or iPad: open the Share menu and choose “Add to Home Screen”.
          </p>
          <p v-else-if="pwa.capability === 'insecure'" class="field-hint" data-test="install-insecure">
            Installing needs a secure context (HTTPS or localhost). Tracking still works in this browser.
          </p>
          <p v-else class="field-hint" data-test="install-unsupported">
            This browser does not offer an install prompt — tracking still works here.
          </p>
          <p v-if="installMessage" class="sync-action-message" role="status" data-test="install-message">
            {{ installMessage }}
          </p>
          <p class="field-hint">
            Installing is optional and changes no guarantees: there are no background alarms or
            push delivery, sync only runs while the app is open, and browser data can still be
            cleared by the system.
          </p>
        </div>
      </div>

      <div class="settings-footer">
        <ul v-if="validationMessages.length" class="settings-errors" role="alert" data-test="settings-errors">
          <li v-for="message in validationMessages" :key="message">{{ message }}</li>
        </ul>
        <button class="btn-cancel" @click="close">Cancel</button>
        <button class="btn-save" :class="{ disabled: !hasChanges || hasInvalidAllocations }" :disabled="!hasChanges || hasInvalidAllocations" @click="saveSettings">Save Settings</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-view {
  display: flex;
  justify-content: center;
  padding: 1rem;
}

.settings-panel {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  max-width: 720px;
  width: 100%;
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

.header-right {
  display: flex;
  align-items: center;
  gap: 0.75rem;
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

.local-storage {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--border-color);
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

.sync-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.sync-action-message {
  margin: 0.25rem 0 0;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.sync-conflict-list {
  list-style: none;
  margin: 0.5rem 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.sync-conflict-item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.625rem 0.75rem;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-tertiary);
}

.sync-conflict-text {
  font-size: 0.8125rem;
  color: var(--text-primary);
  overflow-wrap: anywhere;
}

.sync-conflict-buttons {
  display: flex;
  gap: 0.5rem;
}

.field-error {
  margin: 0.25rem 0 0;
  font-size: 0.8125rem;
  color: var(--color-danger-text);
}

.field-hint {
  margin: 0.25rem 0 0;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.goal-list {
  list-style: none;
  margin: 0.5rem 0;
  padding: 0;
  display: grid;
  gap: 4px;
}

.goal-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  min-height: 44px;
}

.goal-fav {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 44px;
  cursor: pointer;
  color: var(--text-muted);
}

.goal-fav input {
  width: 18px;
  height: 18px;
}

.goal-fav input:checked + span {
  color: var(--color-primary);
}

.goal-name {
  flex: 1 1 140px;
  min-width: 120px;
  min-height: 44px;
  padding: 0.4rem 0.6rem;
  font-size: 0.9375rem;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-primary);
}

.goal-name:focus {
  outline: none;
  border-color: var(--accent-purple);
}

.goal-row.is-archived .goal-name {
  opacity: 0.6;
  font-style: italic;
}

.goal-controls {
  display: inline-flex;
  gap: 4px;
}

.btn-row {
  min-height: 44px;
  min-width: 44px;
  padding: 0.3rem 0.6rem;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-primary);
  font-size: 0.8125rem;
  cursor: pointer;
}

.btn-row:hover:not(:disabled) {
  background: var(--bg-hover);
}

.btn-row:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.goal-row select {
  min-height: 44px;
  font-size: 0.875rem;
}

.goal-hours {
  width: 84px;
  min-height: 44px;
  font-size: 1rem;
}

.goal-capacity {
  margin: 0.5rem 0;
  font-size: 0.875rem;
  color: var(--text-muted);
}

.goal-capacity.is-over {
  color: var(--color-danger-text);
  font-weight: 650;
}

.status-badge {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 0.875rem;
  font-weight: 600;
}

.status-badge.status-ok {
  --_button-surface: var(--color-primary);
  background: var(--_button-surface);
  color: var(--color-on-primary);
}

.status-badge.status-fail {
  --_button-surface: var(--color-danger);
  background: var(--_button-surface);
  color: var(--color-on-danger);
}

@supports (color: contrast-color(red)) {
  .status-badge.status-ok,
  .status-badge.status-fail {
    color: contrast-color(var(--_button-surface));
  }
}

@media (max-width: 480px) {
  .settings-section input:not([type='radio']):not([type='checkbox']),
  .settings-section select {
    width: 100%;
    min-width: 0;
    font-size: 1rem;
  }

  .backend-url-row {
    flex-wrap: wrap;
  }

  .backend-url-input {
    flex: 1 1 100%;
    min-width: 0;
  }

  .settings-footer {
    flex-wrap: wrap;
  }

  .settings-errors {
    flex: 1 1 100%;
    margin: 0;
    padding-left: 18px;
    color: var(--color-danger-text);
  }
}
</style>
