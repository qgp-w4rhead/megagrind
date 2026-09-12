<script setup lang="ts">
import type { TimeEntry } from '../types'
import { X } from 'lucide-vue-next'

defineProps<{ entries: TimeEntry[] }>()
const emit = defineEmits<{ delete: [id: string] }>()

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

function formatEntryTime(entry: TimeEntry): string {
  return new Date(entry.start).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}
</script>

<template>
  <div class="entry-list">
    <div v-if="entries.length === 0" class="empty-state" data-test="empty-state">
      No entries yet today
    </div>
    <div
      v-for="entry in entries"
      :key="entry.id"
      class="entry-item"
      data-test="entry-item"
    >
      <div class="entry-left">
        <span class="entry-time">{{ formatEntryTime(entry) }}</span>
        <span v-if="entry.category" class="entry-category">{{ entry.category }}</span>
        <span v-if="entry.description" class="entry-description">{{ entry.description }}</span>
      </div>
      <div class="entry-right">
        <span class="entry-duration">{{ formatTime(entry.end! - entry.start) }}</span>
        <button
          class="delete-btn"
          data-test="delete-entry"
          title="Delete entry"
          @click="emit('delete', entry.id)"
        >
          <X :size="14" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.entry-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 8px;
}

.empty-state {
  font-size: 0.75rem;
  color: var(--text-muted, #888);
  padding: 4px 0;
}

.entry-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 6px;
  border-radius: 6px;
  font-size: 0.75rem;
  background: var(--surface-2, rgba(255, 255, 255, 0.04));
}

.entry-left {
  display: flex;
  gap: 8px;
  align-items: baseline;
  min-width: 0;
}

.entry-time {
  color: var(--text-muted, #888);
  font-variant-numeric: tabular-nums;
}

.entry-category {
  color: var(--accent, #4f8ef0);
  text-transform: capitalize;
}

.entry-description {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.entry-right {
  display: flex;
  gap: 6px;
  align-items: center;
}

.entry-duration {
  font-variant-numeric: tabular-nums;
}

.delete-btn {
  display: flex;
  align-items: center;
  border: none;
  background: transparent;
  color: var(--text-muted, #888);
  cursor: pointer;
  padding: 2px;
  border-radius: 4px;
}

.delete-btn:hover {
  color: #e05a5a;
}
</style>
