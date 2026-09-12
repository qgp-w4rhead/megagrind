<script setup lang="ts">
import { ref, computed, onScopeDispose } from 'vue'
import { useMegagrindStore } from '../stores/megagrind'
import { getTrackerConfig } from '../config/trackers'
import { Square } from 'lucide-vue-next'

const store = useMegagrindStore()

const now = ref(Date.now())
const interval = setInterval(() => {
  now.value = Date.now()
}, 1000)
onScopeDispose(() => clearInterval(interval))

const session = computed(() => store.activeSession)
const config = computed(() =>
  session.value.type ? getTrackerConfig(session.value.type) : null,
)
const elapsed = computed(() =>
  session.value.startTime !== null
    ? Math.max(0, now.value - session.value.startTime)
    : 0,
)

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
</script>

<template>
  <div class="now-bar" :style="config ? { '--accent': config.accent } : {}">
    <template v-if="session.type && config">
      <component :is="config.icon" class="now-icon" :size="18" />
      <span class="now-label">{{ config.label }}</span>
      <span v-if="session.description" class="now-desc">{{
        session.description
      }}</span>
      <span class="now-elapsed" data-test="now-elapsed">{{
        formatTime(elapsed)
      }}</span>
      <button
        class="now-stop"
        data-test="now-stop"
        title="Stop session"
        @click="store.stopSession()"
      >
        <Square :size="14" /> Stop
      </button>
    </template>
    <span v-else class="now-idle">Nothing tracked right now</span>
  </div>
</template>

<style scoped>
.now-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--surface, rgba(255, 255, 255, 0.04));
  border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
  border-left: 3px solid var(--accent, #8a8f98);
  font-size: 0.85rem;
}

.now-icon {
  color: var(--accent, #8a8f98);
  flex-shrink: 0;
}

.now-label {
  font-weight: 600;
}

.now-desc {
  color: var(--text-muted, #888);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.now-elapsed {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  color: var(--accent, #4f8ef0);
}

.now-desc + .now-elapsed {
  margin-left: 0;
}

.now-stop {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 6px;
  border: none;
  background: #e05a5a;
  color: #fff;
  font-size: 0.75rem;
  cursor: pointer;
}

.now-idle {
  color: var(--text-muted, #888);
}
</style>
