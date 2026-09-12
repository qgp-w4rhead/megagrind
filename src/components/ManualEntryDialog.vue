<script setup lang="ts">
import { ref, computed } from 'vue'
import type { TrackerType } from '../types'

const props = defineProps<{
  type: TrackerType
  show: boolean
  categories?: string[]
}>()

const emit = defineEmits<{
  save: [
    entry: {
      type: TrackerType
      start: number
      end: number
      description?: string
      category?: string
    },
  ]
  close: []
}>()

const startInput = ref('')
const endInput = ref('')
const description = ref('')
const category = ref('')

const canSave = computed(() => {
  if (!startInput.value || !endInput.value) return false
  return (
    new Date(endInput.value).getTime() > new Date(startInput.value).getTime()
  )
})

function save() {
  if (!canSave.value) return
  emit('save', {
    type: props.type,
    start: new Date(startInput.value).getTime(),
    end: new Date(endInput.value).getTime(),
    description: description.value.trim() || undefined,
    category: category.value || undefined,
  })
  startInput.value = ''
  endInput.value = ''
  description.value = ''
  category.value = ''
}
</script>

<template>
  <div v-if="show" class="manual-entry" data-test="manual-entry">
    <div class="field-row">
      <label>Start</label>
      <input v-model="startInput" type="datetime-local" data-test="start-input" />
    </div>
    <div class="field-row">
      <label>End</label>
      <input v-model="endInput" type="datetime-local" data-test="end-input" />
    </div>
    <div v-if="categories && categories.length" class="field-row">
      <label>Category</label>
      <select v-model="category" data-test="category-select">
        <option v-for="c in categories" :key="c" :value="c">{{ c }}</option>
      </select>
    </div>
    <div class="field-row">
      <label>Description</label>
      <input
        v-model="description"
        type="text"
        placeholder="Optional"
        data-test="description-input"
      />
    </div>
    <div class="actions">
      <button class="btn cancel" data-test="cancel-entry" @click="emit('close')">
        Cancel
      </button>
      <button
        class="btn save"
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
  gap: 8px;
  padding: 10px;
  margin-top: 8px;
  border-radius: 8px;
  background: var(--surface-2, rgba(255, 255, 255, 0.05));
  font-size: 0.8rem;
}

.field-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.field-row label {
  width: 70px;
  color: var(--text-muted, #888);
}

.field-row input,
.field-row select {
  flex: 1;
  padding: 4px 6px;
  border-radius: 6px;
  border: 1px solid var(--border, rgba(255, 255, 255, 0.12));
  background: var(--surface, rgba(0, 0, 0, 0.2));
  color: inherit;
  font-size: 0.8rem;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.btn {
  padding: 4px 12px;
  border-radius: 6px;
  border: none;
  cursor: pointer;
  font-size: 0.8rem;
}

.btn.cancel {
  background: transparent;
  color: var(--text-muted, #888);
}

.btn.save {
  background: var(--accent, #4f8ef0);
  color: #fff;
}

.btn.save:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
