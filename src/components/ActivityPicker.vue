<script setup lang="ts">
import { ref, computed } from 'vue'
import { useMegagrindStore } from '../stores/megagrind'
import { activityLabel } from '../domain/labels'
import { getTrackerConfig } from '../config/trackers'
import type { TrackerType } from '../types'
import type { StartActivityEvent } from '../types/appEvents'

const store = useMegagrindStore()

const props = defineProps<{
  activities: TrackerType[]
  workCategories: string[]
  choreCategories: string[]
  currentType: TrackerType | null
}>()

const emit = defineEmits<{
  start: [event: StartActivityEvent]
  cancel: []
}>()

const search = ref('')
const selected = ref<TrackerType | null>(null)
const description = ref('')
const category = ref('')

function labelOf(type: TrackerType): string {
  return activityLabel(type, store.settings.activities)
}

function accentOf(type: TrackerType): string {
  return getTrackerConfig(type).accent
}

const filtered = computed(() => {
  const query = search.value.trim().toLowerCase()
  if (!query) return props.activities
  return props.activities.filter((t) => labelOf(t).toLowerCase().includes(query) || t.toLowerCase().includes(query))
})

const categoryChoices = computed(() => {
  if (selected.value === 'work') return props.workCategories
  if (selected.value === 'chores') return props.choreCategories
  return []
})

function choose(type: TrackerType) {
  selected.value = type
  description.value = ''
  category.value = ''
}

function start() {
  if (!selected.value) return
  emit('start', {
    type: selected.value,
    description: description.value.trim() || undefined,
    category: category.value || undefined,
  })
  selected.value = null
}
</script>

<template>
  <div class="activity-picker">
    <div class="picker-field">
      <label for="activity-search">Search activities</label>
      <input id="activity-search" v-model="search" type="search" autocomplete="off" />
    </div>

    <ul v-if="!selected" class="picker-list" aria-label="Activities">
      <li v-for="type in filtered" :key="type">
        <button
          type="button"
          class="picker-option"
          :style="{ '--activity-accent': accentOf(type) }"
          data-test="pick-activity"
          @click="choose(type)"
        >
          {{ labelOf(type) }}
          <span v-if="type === currentType" class="picker-current">(running)</span>
        </button>
      </li>
      <li v-if="filtered.length === 0" class="picker-empty">No activity matches that search.</li>
    </ul>

    <form v-else class="picker-details" @submit.prevent="start">
      <p>Start <strong>{{ labelOf(selected) }}</strong>. Your running activity, if any, ends at this same moment.</p>
      <div class="picker-field">
        <label for="activity-description">Description (optional)</label>
        <input id="activity-description" v-model="description" type="text" />
      </div>
      <div v-if="categoryChoices.length" class="picker-field">
        <label for="activity-category">Category (optional)</label>
        <select id="activity-category" v-model="category">
          <option value="">No category</option>
          <option v-for="c in categoryChoices" :key="c" :value="c">{{ c }}</option>
        </select>
      </div>
      <div class="picker-actions">
        <button type="button" class="btn-action" @click="selected = null">Back</button>
        <button type="submit" class="btn-primary" data-test="start-picked">Start activity</button>
      </div>
    </form>

    <div v-if="!selected" class="picker-actions">
      <button type="button" class="btn-action" data-test="picker-cancel" @click="emit('cancel')">Cancel</button>
    </div>
  </div>
</template>

<style scoped>
.activity-picker {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.picker-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.picker-field label {
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.picker-field input,
.picker-field select {
  width: 100%;
  min-height: 44px;
  padding: 8px 10px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-control);
  background: var(--control-bg);
  color: var(--color-text);
  font: inherit;
  font-size: 1rem;
}

.picker-field input:focus,
.picker-field select:focus {
  outline: none;
  border-color: var(--color-primary);
}

.picker-list {
  list-style: none;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 8px;
  padding: 0;
}

.picker-option {
  --activity-accent: var(--color-border);
  width: 100%;
  min-height: 44px;
  padding: 8px 10px 8px 14px;
  border: 1px solid var(--hairline);
  border-left: 3px solid var(--activity-accent);
  border-radius: var(--radius-control);
  background: var(--control-bg);
  color: var(--color-text);
  font: inherit;
  font-size: 0.9375rem;
  text-align: left;
  overflow-wrap: anywhere;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.picker-option:hover {
  background: var(--control-bg-hover);
  border-color: var(--color-border);
  border-left-color: var(--activity-accent);
}

.picker-current,
.picker-empty {
  color: var(--color-text-muted);
  font-size: 0.875rem;
}

.picker-details {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.picker-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}
</style>
