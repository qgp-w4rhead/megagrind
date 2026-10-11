<script setup lang="ts">
import { ref, computed, watchEffect } from 'vue'
import { useMegagrindStore } from '../stores/megagrind'
import { useSessionTimer } from '../composables/useSessionTimer'
import { getTrackerConfig } from '../config/trackers'
import type { TrackerType } from '../types'
import { Play, Square, Plus } from 'lucide-vue-next'
import EntryList from './EntryList.vue'
import ManualEntryDialog from './ManualEntryDialog.vue'

const props = defineProps<{ type: TrackerType }>()

const store = useMegagrindStore()
const config = computed(() => getTrackerConfig(props.type))
const { isRunning, elapsed, todayTotal, weekTotal, history, stop } =
  useSessionTimer(props.type)

const showForm = ref(false)
const showManual = ref(false)
const description = ref('')
const category = ref('')

const categories = computed(
  () => config.value.categories?.(store.settings) ?? [],
)
const needsForm = computed(
  () => Boolean(config.value.requiresDescription) || categories.value.length > 0,
)
const canConfirm = computed(
  () =>
    !config.value.requiresDescription ||
    description.value.trim().length > 0,
)

// Default the category select to the first available category.
watchEffect(() => {
  if (!category.value && categories.value.length > 0) {
    category.value = categories.value[0]!
  }
})

function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`
}

function formatHours(ms: number): string {
  return (ms / (60 * 60 * 1000)).toFixed(1)
}

function onStartClick() {
  if (needsForm.value) {
    showForm.value = true
  } else {
    store.startSession(props.type, undefined, undefined)
  }
}

function confirmStart() {
  if (!canConfirm.value) return
  // Category doubles as the description when none is required (chores),
  // matching the previous per-type tracker behavior.
  const desc = description.value.trim() || category.value || undefined
  store.startSession(props.type, desc, category.value || undefined)
  description.value = ''
  showForm.value = false
}

function onStopClick() {
  stop()
}

function requestDelete(id: string) {
  if (window.confirm('Delete this entry?')) store.deleteEntry(id)
}

function onManualSave(entry: {
  type: TrackerType
  start: number
  end: number | null
  description?: string
  category?: string
}) {
  store.addManualEntry(entry)
  showManual.value = false
}
</script>

<template>
  <div
    class="session-tracker"
    :class="{ running: isRunning }"
    :style="{ '--accent': config.accent }"
  >
    <div class="tracker-header">
      <component
        :is="config.icon"
        class="tracker-icon"
        data-test="tracker-icon"
        :size="20"
      />
      <span class="tracker-label">{{ config.label }}</span>
      <span
        v-if="isRunning || config.passive"
        class="elapsed"
        data-test="elapsed"
        >{{ formatTime(elapsed) }}</span
      >
    </div>

    <div class="tracker-controls">
      <template v-if="!config.passive">
        <button
          v-if="!isRunning && !showForm"
          class="control-btn start"
          data-test="start-btn"
          @click="onStartClick"
        >
          <Play :size="14" /> Start
        </button>
        <button
          v-if="isRunning"
          class="control-btn stop"
          data-test="stop-btn"
          @click="onStopClick"
        >
          <Square :size="14" /> Stop
        </button>
      </template>
      <button
        class="control-btn icon-only"
        data-test="manual-btn"
        title="Add manual entry"
        @click="showManual = !showManual"
      >
        <Plus :size="14" />
      </button>
    </div>

    <div v-if="showForm && !isRunning" class="start-form">
      <select
        v-if="categories.length"
        v-model="category"
        class="form-select"
        data-test="category-select"
      >
        <option v-for="c in categories" :key="c" :value="c">{{ c }}</option>
      </select>
      <input
        v-if="config.requiresDescription"
        v-model="description"
        class="form-input"
        data-test="description-input"
        placeholder="What are you working on?"
        @keyup.enter="confirmStart"
      />
      <button
        class="control-btn confirm"
        data-test="confirm-start"
        :disabled="!canConfirm"
        @click="confirmStart"
      >
        Go
      </button>
    </div>

    <div class="tracker-totals">
      <span data-test="today-total">Today {{ formatHours(todayTotal) }}h</span>
      <span data-test="week-total">Week {{ formatHours(weekTotal) }}h</span>
    </div>

    <ManualEntryDialog
      :type="props.type"
      :show="showManual"
      :categories="categories"
      @save="onManualSave"
      @close="showManual = false"
    />

    <EntryList
      :entries="history"
      @request-delete="requestDelete"
    />
  </div>
</template>

<style scoped>
.session-tracker {
  padding: 12px;
  border-radius: 10px;
  background: var(--surface, rgba(255, 255, 255, 0.03));
  border: 1px solid var(--border, rgba(255, 255, 255, 0.08));
  border-left: 3px solid var(--accent, #8a8f98);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.session-tracker.running {
  border-color: var(--accent, #4f8ef0);
  box-shadow: 0 0 12px -4px var(--accent, #4f8ef0);
}

.tracker-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tracker-icon {
  color: var(--accent, #8a8f98);
  flex-shrink: 0;
}

.tracker-label {
  font-weight: 600;
  font-size: 0.85rem;
  flex: 1;
}

.elapsed {
  font-variant-numeric: tabular-nums;
  font-size: 0.9rem;
  color: var(--accent, #4f8ef0);
  font-weight: 600;
}

.tracker-controls {
  display: flex;
  gap: 6px;
}

.control-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  border-radius: 6px;
  border: none;
  font-size: 0.75rem;
  cursor: pointer;
  background: var(--surface-2, rgba(255, 255, 255, 0.06));
  color: inherit;
}

.control-btn.start {
  background: var(--accent, #4f8ef0);
  color: #fff;
}

.control-btn.stop {
  background: #e05a5a;
  color: #fff;
}

.control-btn.icon-only {
  margin-left: auto;
}

.control-btn.confirm {
  background: var(--accent, #4f8ef0);
  color: #fff;
}

.control-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.start-form {
  display: flex;
  gap: 6px;
  align-items: center;
}

.form-select,
.form-input {
  flex: 1;
  min-width: 0;
  padding: 5px 8px;
  border-radius: 6px;
  border: 1px solid var(--border, rgba(255, 255, 255, 0.12));
  background: var(--surface, rgba(0, 0, 0, 0.2));
  color: inherit;
  font-size: 0.75rem;
}

.tracker-totals {
  display: flex;
  gap: 12px;
  font-size: 0.7rem;
  color: var(--text-muted, #888);
  font-variant-numeric: tabular-nums;
}
</style>
