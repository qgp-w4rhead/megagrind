<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useMegagrindStore } from './stores/megagrind'
import ActivityPicker from './components/ActivityPicker.vue'
import AppDialog from './components/AppDialog.vue'
import AppNav from './components/AppNav.vue'
import FocusToggle from './components/FocusToggle.vue'
import ManualEntryDialog from './components/ManualEntryDialog.vue'
import NowBar from './components/NowBar.vue'
import ProgressCheck from './components/ProgressCheck.vue'
import SyncStatus from './components/SyncStatus.vue'
import { useProgressScheduler } from './composables/useProgressScheduler'
import { useShellLayout } from './composables/useShellLayout'
import { useTabCoordination } from './composables/useTabCoordination'
import { activityChoices } from './domain/activities'
import { activityLabel } from './domain/labels'
import { formatDuration } from './domain/today'
import { downloadRecoveryCopy } from './stores/persistencePlugin'
import type { TimeEntry, TrackerType } from './types'
import type { AddEntryEvent, EntryRef, StartActivityEvent } from './types/appEvents'

interface EntryPayload {
  id?: string
  type: TrackerType
  start: number
  end: number | null
  description?: string
  category?: string
}

const store = useMegagrindStore()
store.migrateSettings()
const tabs = useTabCoordination(store)
useProgressScheduler(store, { isLeader: tabs.isLeader })

const shellEl = ref<HTMLElement | null>(null)
useShellLayout(() => shellEl.value)

const feedback = ref('')
const pickerOpen = ref(false)
const editor = ref<{ entry: TimeEntry | null; type: TrackerType } | null>(null)
const pendingDeleteId = ref<string | null>(null)
const pendingDelete = computed<TimeEntry | null>(() => store.entries.find((e) => e.id === pendingDeleteId.value) ?? null)
const undo = ref<{ entry: TimeEntry; label: string } | null>(null)
const editorDirty = ref(false)
const router = useRouter()

const choices = computed(() => activityChoices(store.settings.customChronos ?? [], store.entries.map((e) => e.type)))
const activeEntry = computed(() => store.entries.find((e) => e.end === null && e.type !== 'idle') ?? null)

function labelOf(type: TrackerType): string {
  return activityLabel(type)
}

function categoriesFor(type: TrackerType): string[] | undefined {
  if (type === 'work') return store.settings.workCategories
  if (type === 'chores') return store.settings.choreCategories
  return undefined
}

function startActivity(event: StartActivityEvent) {
  const wasRunning = store.activeSession.type !== null
  store.startSession(event.type, event.description, event.category)
  pickerOpen.value = false
  feedback.value = `${wasRunning ? 'Switched to' : 'Started'} ${labelOf(event.type)}.`
}

function openCreate(event: AddEntryEvent) {
  editor.value = { entry: null, type: event.type ?? 'work' }
}

function openEdit(ref: EntryRef) {
  const entry = store.entries.find((e) => e.id === ref.id)
  if (entry) editor.value = { entry, type: entry.type }
}

function openEditActive() {
  const entry = activeEntry.value
  if (entry) editor.value = { entry, type: entry.type }
}

function closeEditor() {
  if (editorDirty.value && !window.confirm('Discard unsaved changes to this entry?')) return
  editor.value = null
  editorDirty.value = false
}

const removeNavigationGuard = router.beforeEach(() => {
  if (editor.value && editorDirty.value) {
    if (!window.confirm('Discard unsaved changes to this entry?')) return false
    editor.value = null
    editorDirty.value = false
  }
  return true
})

onBeforeUnmount(() => {
  removeNavigationGuard()
})

function saveEntry(payload: EntryPayload) {
  const fields = {
    type: payload.type,
    start: payload.start,
    end: payload.end,
    description: payload.description,
    category: payload.category,
  }
  if (payload.id) {
    const current = store.entries.find((e) => e.id === payload.id)
    if (current && current.end === null && payload.end !== null && current.type !== 'idle') {
      store.stopSession()
    }
    store.updateEntry(payload.id, fields)
  } else {
    store.addManualEntry(fields)
  }
  editor.value = null
  editorDirty.value = false
  feedback.value = store.saveSucceeded('Entry')
}

function requestDelete(ref: EntryRef) {
  const entry = store.entries.find((e) => e.id === ref.id)
  if (!entry) return
  if (entry.end === null) {
    feedback.value = 'Finish the running entry with Stop or Edit before deleting it.'
    return
  }
  pendingDeleteId.value = entry.id
}

function cancelDelete() {
  pendingDeleteId.value = null
}

function confirmDelete() {
  const entry = pendingDelete.value
  if (!entry) return
  if (entry.end === null) {
    pendingDeleteId.value = null
    feedback.value = 'Finish the running entry with Stop or Edit before deleting it.'
    return
  }
  undo.value = { entry: { ...entry }, label: labelOf(entry.type) }
  store.deleteEntry(entry.id)
  pendingDeleteId.value = null
  feedback.value = store.saveSucceeded('Entry deletion')
}

function undoDelete() {
  if (!undo.value) return
  const error = store.restoreEntry(undo.value.entry)
  if (error) {
    feedback.value = error
    return
  }
  feedback.value = store.saveSucceeded('Entry restore')
  undo.value = null
}

function retryStorage() {
  store.retryPersistence()
}

function resolveSessionConflict(keepId: string | null) {
  const error = store.resolveOpenEntries(keepId)
  feedback.value = error ?? store.saveSucceeded('Running sessions')
}

const syncConflictDialogOpen = ref(false)
watch(
  () => store.syncConflicts.length,
  (count, prev) => {
    if (count > 0 && prev === 0) syncConflictDialogOpen.value = true
  },
)

function resolveSyncConflict(resource: string, choice: 'keep-local' | 'keep-remote') {
  store.resolveSyncConflict(resource, choice)
  if (store.syncConflicts.length === 0) syncConflictDialogOpen.value = false
  feedback.value = choice === 'keep-local' ? 'Your change will be sent to the server.' : 'The server version was applied locally.'
}

function describeConflict(conflict: { remoteKind: string }): string {
  switch (conflict.remoteKind) {
    case 'entry': return 'the server has a different version'
    case 'tombstone': return 'it was deleted on the server'
    case 'preferences': return 'the server has different preferences'
    default: return 'the server has no record of it'
  }
}

function exportStorageCopy() {
  if (!downloadRecoveryCopy()) feedback.value = 'No stored recovery copy is available to export.'
}

const systemLight = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  ? window.matchMedia('(prefers-color-scheme: light)')
  : null

function onSystemThemeChange() {
  if (store.settings.darkMode === 'auto') updateTheme()
}

onMounted(() => {
  store.resetStaleProgressCheck()
  store.initIdle()
  updateTheme()
  systemLight?.addEventListener('change', onSystemThemeChange)
  // Load remote entries/settings when a backend is configured.
  // Returns early in local mode. Errors are logged inside.
  store.initFromBackend()
})

onBeforeUnmount(() => {
  systemLight?.removeEventListener('change', onSystemThemeChange)
})

function updateTheme() {
  const mode = store.settings.darkMode
  let theme = 'dark'
  if (mode === 'auto') {
    theme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  } else {
    theme = mode
  }
  document.body.classList.remove('dark', 'light')
  document.body.classList.add(theme)
}

watch(() => store.settings.darkMode, updateTheme)
</script>

<template>
  <div ref="shellEl" class="app">
    <a href="#main" class="skip-link">Skip to content</a>

    <header class="app-header">
      <div class="app-brand">
        <p class="app-brand-name">MEGAGRIND</p>
        <p class="app-brand-tagline">Personal time tracking</p>
      </div>
      <div class="app-header-actions">
        <FocusToggle v-if="store.settings.progressCheckEnabled" />
        <SyncStatus />
        <button type="button" class="btn-primary" data-test="app-start-activity" @click="pickerOpen = true">Start activity</button>
      </div>
      <AppNav class="app-header-nav" />
    </header>

    <div class="app-now" data-test="app-now">
      <NowBar @switch="pickerOpen = true" @edit="openEditActive" />
    </div>

    <main id="main" class="app-main" tabindex="-1">
      <ProgressCheck v-if="store.settings.progressCheckEnabled" />
      <router-view v-slot="{ Component }">
        <component
          :is="Component"
          @start-activity="startActivity"
          @open-activities="pickerOpen = true"
          @add-entry="openCreate"
          @edit-entry="openEdit"
          @delete-entry="requestDelete"
        />
      </router-view>
    </main>

    <div v-if="store.persistenceState !== 'ready'" class="storage-warning" role="alert" data-test="storage-warning">
      <p>
        <strong>{{ store.persistenceState === 'recovery' ? 'Storage needs recovery' : 'Temporary memory-only tracking' }}</strong>
        — {{ store.persistenceError ?? 'Browser storage could not save this session.' }}
      </p>
      <div class="storage-warning-actions">
        <button type="button" class="btn-action" data-test="storage-retry" @click="retryStorage">Retry storage</button>
        <button type="button" class="btn-action" data-test="storage-export" @click="exportStorageCopy">Export recovery copy</button>
        <RouterLink class="btn-action" to="/settings">Open restore settings</RouterLink>
      </div>
    </div>

    <p v-if="feedback" class="app-feedback" role="status">
      {{ feedback }}
      <button
        v-if="undo"
        type="button"
        class="btn-action"
        data-test="undo-delete"
        @click="undoDelete"
      >
        Undo delete of {{ undo.label }}
      </button>
    </p>

    <AppDialog :show="pickerOpen" title="All activities" @close="pickerOpen = false">
      <ActivityPicker
        v-if="pickerOpen"
        :activities="choices"
        :current-type="store.currentSessionType"
        :work-categories="store.settings.workCategories"
        :chore-categories="store.settings.choreCategories"
        @start="startActivity"
        @cancel="pickerOpen = false"
      />
    </AppDialog>

    <AppDialog
      :show="editor !== null"
      :title="editor?.entry ? 'Edit entry' : 'Add missed time'"
      @close="closeEditor"
    >
      <ManualEntryDialog
        v-if="editor"
        :show="true"
        :type="editor.type"
        :entry="editor.entry ?? undefined"
        :categories="categoriesFor(editor.type)"
        :activities="choices"
        @save="saveEntry"
        @dirty="editorDirty = $event"
        @close="closeEditor"
      />
    </AppDialog>

    <AppDialog :show="pendingDelete !== null" title="Delete entry?" @close="cancelDelete">
      <p>
        This removes the {{ pendingDelete ? labelOf(pendingDelete.type) : '' }} entry
        ({{ pendingDelete ? formatDuration((pendingDelete.end ?? store.now) - pendingDelete.start) : '' }}).
        You can undo right after.
      </p>
      <template #footer>
        <button type="button" class="btn-action" data-test="delete-cancel" @click="cancelDelete">Cancel</button>
        <button type="button" class="btn-danger" data-test="delete-confirm" @click="confirmDelete">Delete</button>
      </template>
    </AppDialog>

    <AppDialog
      :show="syncConflictDialogOpen"
      title="Resolve sync conflicts"
      @close="syncConflictDialogOpen = false"
    >
      <p>
        Changes on this device and on the server diverged. Choose which version to keep
        for each item — nothing is merged silently.
      </p>
      <ul class="conflict-list">
        <li v-for="conflict in store.syncConflicts" :key="conflict.resource" class="conflict-card">
          <div class="conflict-info">
            <span class="conflict-label">{{ conflict.label }}</span>
            <span class="conflict-meta">{{ describeConflict(conflict) }}</span>
          </div>
          <div class="conflict-actions">
            <button
              type="button"
              class="btn-primary"
              :data-test="`sync-keep-local-${conflict.resource}`"
              @click="resolveSyncConflict(conflict.resource, 'keep-local')"
            >
              Keep mine
            </button>
            <button
              type="button"
              class="btn-action"
              :data-test="`sync-keep-remote-${conflict.resource}`"
              @click="resolveSyncConflict(conflict.resource, 'keep-remote')"
            >
              Use server's
            </button>
          </div>
        </li>
      </ul>
    </AppDialog>

    <AppDialog
      :show="store.openSessionConflict"
      title="Resolve running sessions"
      :dismissible="false"
    >
      <p>
        More than one entry is marked as running — usually from two tabs or devices starting
        activities at the same time. Choose the one that is actually running; the others
        are closed at its start time. No records are deleted.
      </p>
      <ul class="conflict-list">
        <li v-for="entry in store.openEntries" :key="entry.id" class="conflict-card">
          <div class="conflict-info">
            <span class="conflict-label">{{ labelOf(entry.type) }}</span>
            <span class="conflict-meta">
              running for {{ formatDuration(Math.max(0, store.now - entry.start)) }}
            </span>
          </div>
          <button
            type="button"
            class="btn-primary"
            :data-test="`conflict-keep-${entry.id}`"
            @click="resolveSessionConflict(entry.id)"
          >
            Keep running
          </button>
        </li>
      </ul>
      <template #footer>
        <button type="button" class="btn-danger" data-test="conflict-end-all" @click="resolveSessionConflict(null)">
          End all running entries
        </button>
      </template>
    </AppDialog>
  </div>
</template>

<style>
.app {
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  padding-top: env(safe-area-inset-top);
  font-family: var(--font-ui);
  background: var(--color-page);
  color: var(--color-text);
}

.app-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 16px;
  padding: 14px 20px;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border-subtle);
  min-width: 0;
}

.app-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.app-brand {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.app-brand-name {
  font-size: 1.125rem;
  font-weight: 750;
  letter-spacing: 0.02em;
  color: var(--color-primary);
}

.app-brand-tagline {
  font-size: 0.8125rem;
  color: var(--color-text-muted);
}

.app-header-nav {
  min-width: 0;
}

.app-now {
  position: sticky;
  top: 0;
  z-index: 20;
  padding: 10px 20px;
  background: var(--color-page);
}

.app-main {
  flex: 1;
  min-width: 0;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  outline: none;
}

.storage-warning,
.app-feedback {
  margin: 0 20px 12px;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--color-surface);
  border: 1px solid var(--color-border-subtle);
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.storage-warning {
  border-color: var(--color-danger);
  justify-content: space-between;
}

.storage-warning-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.conflict-list {
  list-style: none;
  margin: 12px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.conflict-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
}

.conflict-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.conflict-label {
  font-weight: 650;
  overflow-wrap: anywhere;
}

.conflict-meta {
  color: var(--color-text-muted);
  font-size: 0.875rem;
}

.conflict-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

@media (max-width: 767px) {
  .app-header {
    padding: 10px 14px;
  }

  .app-now {
    position: fixed;
    left: 0;
    right: 0;
    bottom: var(--bottom-nav-h, 64px);
    top: auto;
    padding: 4px 8px;
    border-top: 1px solid var(--color-border-subtle);
  }

  .app-main {
    padding: 14px;
    padding-bottom: calc(14px + var(--now-bar-h, 76px) + var(--bottom-nav-h, 64px));
  }

  .storage-warning,
  .app-feedback {
    margin: 0 14px 12px;
  }
}

@media (min-width: 768px) {
  .app-main {
    padding: 24px 28px;
  }
}
</style>
