<script setup lang="ts">
import { ref, computed, watch, useId } from 'vue'
import { useMegagrindStore } from '../stores/megagrind'
import { isTimeAdjustment } from '../domain/time'
import { activityLabel } from '../domain/labels'
import type { TimeEntry, TrackerType } from '../types'

const props = defineProps<{
  type: TrackerType
  show: boolean
  categories?: string[]
  entry?: TimeEntry
  activities?: TrackerType[]
}>()

const emit = defineEmits<{
  save: [
    entry: {
      id?: string
      type: TrackerType
      start: number
      end: number | null
      description?: string
      category?: string
    },
  ]
  close: []
  dirty: [value: boolean]
}>()

const store = useMegagrindStore()

const uid = `manual-entry-${useId()}`

const startInput = ref('')
const endInput = ref('')
const description = ref('')
const category = ref('')
const typeInput = ref<TrackerType>(props.type)
const keepRunning = ref(false)
const confirmOverlap = ref(false)
const touched = ref(false)

let initialSnapshot = ''

function snapshot(): string {
  return JSON.stringify([startInput.value, endInput.value, description.value, category.value, typeInput.value, keepRunning.value])
}

function toLocalInput(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function parseLocal(value: string): number {
  return value ? new Date(value).getTime() : NaN
}

function reset() {
  const e = props.entry
  typeInput.value = e?.type ?? props.type
  startInput.value = e ? toLocalInput(e.start) : ''
  endInput.value = e && e.end !== null ? toLocalInput(e.end) : ''
  keepRunning.value = !!e && e.end === null
  description.value = e?.description ?? ''
  category.value = e?.category ?? ''
  confirmOverlap.value = false
  touched.value = false
  initialSnapshot = snapshot()
}

watch(() => [props.show, props.entry], reset, { immediate: true })

const isDirty = computed(() => snapshot() !== initialSnapshot)
watch(isDirty, (value) => emit('dirty', value))

const isAdjustment = computed(() => !!props.entry && isTimeAdjustment(props.entry))

const typeOptions = computed<TrackerType[]>(() => {
  const list = props.activities ?? []
  const original = props.entry?.type
  return original && !list.includes(original) ? [...list, original] : list
})

const categoryChoices = computed<string[]>(() => {
  if (!props.activities) return props.categories ?? []
  if (typeInput.value === 'work') return store.settings.workCategories ?? []
  if (typeInput.value === 'chores') return store.settings.choreCategories ?? []
  return []
})

const categoryOptions = computed<string[]>(() => {
  const list = categoryChoices.value
  return category.value && !list.includes(category.value) ? [...list, category.value] : list
})

watch(typeInput, (next, previous) => {
  if (previous === undefined || next === previous) return
  if (category.value && !categoryChoices.value.includes(category.value)) category.value = ''
})

function resolvedStart(): number {
  const e = props.entry
  if (e && startInput.value === toLocalInput(e.start)) return e.start
  return parseLocal(startInput.value)
}

function resolvedEnd(): number | null {
  const e = props.entry
  if (keepRunning.value) return null
  if (e && e.end !== null && endInput.value === toLocalInput(e.end)) return e.end
  return parseLocal(endInput.value)
}

const startError = computed<string | null>(() => {
  if (isAdjustment.value) return null
  const start = resolvedStart()
  if (!Number.isFinite(start)) return 'Enter a valid start time.'
  if (start > store.now) return 'Start cannot be in the future.'
  return null
})

const endError = computed<string | null>(() => {
  if (isAdjustment.value || keepRunning.value) return null
  const end = resolvedEnd()
  const start = resolvedStart()
  if (end === null || !Number.isFinite(end)) return 'Enter a valid end time.'
  if (Number.isFinite(start) && end <= start) return 'End must be after start.'
  if (end > store.now) return 'End cannot be in the future.'
  return null
})

const errors = computed(() => [startError.value, endError.value].filter((m): m is string => m !== null))

const showStartError = computed(() => touched.value && startError.value !== null)
const showEndError = computed(() => touched.value && endError.value !== null)

const overlaps = computed(() => {
  if (isAdjustment.value || errors.value.length > 0) return []
  const start = resolvedStart()
  const end = resolvedEnd() ?? store.now
  return store.entries.filter(
    (o) =>
      o.id !== props.entry?.id &&
      !isTimeAdjustment(o) &&
      o.start < end &&
      (o.end ?? store.now) > start,
  )
})

watch(
  () => [resolvedStart(), resolvedEnd(), typeInput.value, overlaps.value.map((o) => o.id).join(',')].join('|'),
  () => {
    confirmOverlap.value = false
  },
)

const canSave = computed(() => {
  if (isAdjustment.value) return true
  if (errors.value.length > 0) return false
  return overlaps.value.length === 0 || confirmOverlap.value
})

function save() {
  if (!canSave.value) return
  const base = {
    type: typeInput.value,
    description: description.value.trim() || undefined,
    category: category.value || undefined,
  }
  if (props.entry) {
    const start = isAdjustment.value ? props.entry.start : resolvedStart()
    const end = isAdjustment.value ? props.entry.end : resolvedEnd()
    emit('save', { id: props.entry.id, ...base, start, end })
    return
  }
  emit('save', { ...base, start: resolvedStart(), end: resolvedEnd() })
  startInput.value = ''
  endInput.value = ''
  description.value = ''
  category.value = ''
  confirmOverlap.value = false
  touched.value = false
}

function label(type: TrackerType): string {
  return activityLabel(type)
}

function describedBy(invalid: boolean): string {
  if (isAdjustment.value) return `${uid}-note`
  return invalid ? `${uid}-errors` : `${uid}-help`
}

function touch() {
  touched.value = true
}
</script>

<template>
  <div v-if="show" class="manual-entry" data-test="manual-entry">
    <p v-if="isAdjustment" :id="`${uid}-note`" class="entry-note">
      Signed correction: its times are kept as recorded. You can edit its context only.
    </p>

    <div v-if="activities && activities.length && !isAdjustment" class="field">
      <label :for="`${uid}-type`">Activity</label>
      <select :id="`${uid}-type`" v-model="typeInput" data-test="type-select">
        <option v-for="t in typeOptions" :key="t" :value="t">{{ label(t) }}</option>
      </select>
    </div>

    <div class="field">
      <label :for="`${uid}-start`">Start</label>
      <input
        :id="`${uid}-start`"
        v-model="startInput"
        type="datetime-local"
        data-test="start-input"
        :disabled="isAdjustment"
        :aria-invalid="showStartError ? 'true' : undefined"
        :aria-describedby="describedBy(showStartError)"
        @input="touch"
        @blur="touch"
      />
    </div>

    <div class="field">
      <label :for="`${uid}-end`">End</label>
      <input
        :id="`${uid}-end`"
        v-model="endInput"
        type="datetime-local"
        data-test="end-input"
        :disabled="isAdjustment || keepRunning"
        :aria-invalid="showEndError ? 'true' : undefined"
        :aria-describedby="describedBy(showEndError)"
        @input="touch"
        @blur="touch"
      />
    </div>

    <p v-if="!isAdjustment" :id="`${uid}-help`" class="field-help">
      Start and end are required. Times cannot be in the future.
    </p>

    <div v-if="entry && entry.end === null && !isAdjustment" class="field field-check">
      <input :id="`${uid}-running`" v-model="keepRunning" type="checkbox" data-test="keep-running" />
      <label :for="`${uid}-running`">Keep running (no end yet)</label>
    </div>

    <div v-if="categoryOptions.length" class="field">
      <label :for="`${uid}-category`">Category</label>
      <select :id="`${uid}-category`" v-model="category" data-test="category-select">
        <option value="">No category</option>
        <option v-for="c in categoryOptions" :key="c" :value="c">{{ c }}</option>
      </select>
    </div>

    <div class="field">
      <label :for="`${uid}-description`">Description</label>
      <input
        :id="`${uid}-description`"
        v-model="description"
        type="text"
        placeholder="Optional"
        data-test="description-input"
      />
    </div>

    <ul v-if="touched && errors.length" :id="`${uid}-errors`" class="form-errors" role="alert" data-test="form-errors">
      <li v-for="message in errors" :key="message">{{ message }}</li>
    </ul>

    <div v-if="overlaps.length" class="overlap" data-test="overlap-preview" role="status">
      <p>This overlaps existing time, including idle time:</p>
      <ul>
        <li v-for="o in overlaps" :key="o.id">{{ label(o.type) }}</li>
      </ul>
      <div class="field field-check">
        <input :id="`${uid}-overlap`" v-model="confirmOverlap" type="checkbox" data-test="confirm-overlap" />
        <label :for="`${uid}-overlap`">Save anyway, overlapping that time</label>
      </div>
    </div>

    <div class="actions">
      <button type="button" class="btn-action" data-test="cancel-entry" @click="emit('close')">
        Cancel
      </button>
      <button
        type="button"
        class="btn-primary"
        data-test="save-entry"
        :disabled="!canSave"
        @click="save"
      >
        Save
      </button>
    </div>
  </div>
</template>

<style scoped>
.manual-entry {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  font-size: 1rem;
  color: var(--color-text);
}

.entry-note,
.field-help {
  color: var(--color-text-muted);
  font-size: 0.9375rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.field-check {
  flex-direction: row;
  align-items: center;
  gap: 8px;
}

.field input:not([type='checkbox']),
.field select {
  width: 100%;
  min-height: 44px;
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
  font-size: 1rem;
}

.field input[aria-invalid='true'] {
  border-color: var(--color-danger-text);
}

.field input:disabled {
  opacity: 0.6;
}

.form-errors {
  color: var(--color-danger-text);
  padding-left: 18px;
  font-size: 0.9375rem;
}

.overlap {
  padding: 10px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface-raised);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.actions .btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
