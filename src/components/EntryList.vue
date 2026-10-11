<script setup lang="ts">
import type { TimeEntry } from '../types'
import { X, Pencil } from 'lucide-vue-next'

defineProps<{ entries: TimeEntry[] }>()
const emit = defineEmits<{ 'request-delete': [id: string]; edit: [id: string] }>()

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
          type="button"
          class="icon-action"
          data-test="edit-entry"
          :aria-label="`Edit entry at ${formatEntryTime(entry)}`"
          title="Edit entry"
          @click="emit('edit', entry.id)"
        >
          <Pencil :size="14" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="icon-action icon-danger"
          data-test="delete-entry"
          :aria-label="`Delete entry at ${formatEntryTime(entry)}`"
          title="Delete entry"
          @click="emit('request-delete', entry.id)"
        >
          <X :size="14" aria-hidden="true" />
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
  font-size: 0.875rem;
  color: var(--color-text-muted);
  padding: 4px 0;
}

.entry-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 8px;
  font-size: 0.875rem;
  background: var(--color-surface-raised);
  min-width: 0;
}

.entry-left {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: baseline;
  min-width: 0;
}

.entry-time {
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

.entry-category {
  text-transform: capitalize;
}

.entry-description {
  overflow-wrap: anywhere;
}

.entry-right {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-shrink: 0;
}

.entry-duration {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}

.icon-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  min-height: 44px;
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
  background: transparent;
  color: var(--color-text);
  cursor: pointer;
}

.icon-danger:hover {
  color: var(--color-danger);
}
</style>
