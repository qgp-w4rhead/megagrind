<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useMegagrindStore } from '../stores/megagrind'

const store = useMegagrindStore()
const router = useRouter()

const label = computed(() => {
  switch (store.syncStatus) {
    case 'local':
      return 'Local only'
    case 'offline': {
      const n = store.pendingSyncCount + store.foreignSyncCount
      return n > 0 ? `Offline — ${n} waiting` : 'Offline'
    }
    case 'pending': {
      const n = store.pendingSyncCount + store.foreignSyncCount
      return `${n} pending`
    }
    case 'syncing':
      return 'Syncing…'
    case 'conflict':
      return 'Sync conflict'
    case 'failed':
      return 'Sync needs attention'
    case 'synced':
      return 'Synced'
    default:
      return 'Local only'
  }
})

const tone = computed(() => {
  switch (store.syncStatus) {
    case 'local':
      return 'muted'
    case 'synced':
      return 'ok'
    case 'syncing':
    case 'pending':
      return 'busy'
    case 'offline':
      return 'warn'
    case 'conflict':
    case 'failed':
      return 'danger'
    default:
      return 'muted'
  }
})

const title = computed(() => {
  const last = store.lastSyncedAt === null ? 'never' : new Date(store.lastSyncedAt).toLocaleString()
  return `Sync status: ${label.value}. Last successful sync: ${last}. Open sync settings.`
})

function open() {
  router.push('/settings')
}
</script>

<template>
  <button
    type="button"
    class="sync-chip"
    :class="`tone-${tone}`"
    :title="title"
    :aria-label="title"
    data-test="sync-status"
    @click="open"
  >
    <span class="sync-dot" aria-hidden="true" />
    <span class="sync-label">{{ label }}</span>
  </button>
</template>

<style scoped>
.sync-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid var(--color-border-subtle);
  background: var(--color-surface);
  color: var(--color-text-muted);
  font: inherit;
  font-size: 0.8125rem;
  cursor: pointer;
  white-space: nowrap;
}

.sync-chip:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}

.sync-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-text-muted);
  flex: none;
}

.tone-ok .sync-dot { background: var(--accent-green); }
.tone-ok { color: var(--color-text); }
.tone-busy .sync-dot { background: var(--color-primary); }
.tone-busy { color: var(--color-text); }
.tone-warn .sync-dot { background: var(--accent-yellow); }
.tone-warn { color: var(--color-text); }
.tone-danger .sync-dot { background: var(--color-danger); }
.tone-danger {
  color: var(--color-danger);
  border-color: var(--color-danger);
}
</style>
