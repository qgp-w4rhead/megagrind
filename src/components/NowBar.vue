<script setup lang="ts">
import { computed } from 'vue'
import { useMegagrindStore } from '../stores/megagrind'
import { getTrackerConfig } from '../config/trackers'
import { Square } from 'lucide-vue-next'

const emit = defineEmits<{ switch: []; edit: [] }>()

const store = useMegagrindStore()

const session = computed(() => store.activeSession)
const config = computed(() =>
  session.value.type ? getTrackerConfig(session.value.type) : null,
)
const elapsed = computed(() =>
  session.value.startTime !== null
    ? Math.max(0, store.now - session.value.startTime)
    : 0,
)
const idleElapsed = computed(() =>
  store.idleStartTime !== null ? Math.max(0, store.now - store.idleStartTime) : 0,
)
const stale = computed(() => store.forgottenEntry !== null)

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
  <div
    class="now-bar"
    data-test="now-bar-root"
    :class="{ 'is-idle': !(session.type && config) }"
    :style="config ? { '--accent': config.accent } : {}"
  >
    <template v-if="session.type && config">
      <div class="now-head">
        <component :is="config.icon" class="now-icon" :size="18" aria-hidden="true" />
        <div class="now-text">
          <span class="now-label">{{ config.label }}</span>
          <span v-if="session.description" class="now-desc">{{ session.description }}</span>
        </div>
        <span class="now-elapsed" data-test="now-elapsed">{{ formatTime(elapsed) }}</span>
      </div>
      <p v-if="stale" class="now-stale" data-test="now-stale" role="status">
        Still tracking after {{ formatTime(elapsed) }} — check this session is not forgotten.
      </p>
      <div class="now-actions">
        <button type="button" class="btn-action" data-test="now-switch" @click="emit('switch')">Switch</button>
        <button type="button" class="btn-action" data-test="now-edit" @click="emit('edit')">Edit</button>
        <button
          type="button"
          class="btn-action now-stop"
          data-test="now-stop"
          title="Stop session"
          @click="store.stopSession()"
        >
          <Square :size="14" aria-hidden="true" /> Stop
        </button>
      </div>
    </template>
    <template v-else-if="store.idleStartTime !== null">
      <div class="now-summary">
        <span class="now-idle">Idle being tracked</span>
        <span class="now-elapsed" data-test="now-elapsed">{{ formatTime(idleElapsed) }}</span>
      </div>
      <button type="button" class="btn-primary" data-test="now-switch" @click="emit('switch')">Start activity</button>
    </template>
    <template v-else>
      <div class="now-summary">
        <span class="now-idle">Nothing tracked right now</span>
      </div>
      <button type="button" class="btn-primary" data-test="now-switch" @click="emit('switch')">Start activity</button>
    </template>
  </div>
</template>

<style scoped>
.now-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 10px 16px 10px 14px;
  border-radius: var(--radius-panel);
  background:
    linear-gradient(90deg, color-mix(in oklch, var(--accent, var(--color-surface)) 10%, transparent) 0%, transparent 34%),
    var(--surface-sheen);
  border: 1px solid var(--hairline);
  border-left: 3px solid var(--accent, var(--color-border));
  box-shadow: var(--shadow-panel);
  color: var(--color-text);
  font-size: 0.9375rem;
  min-width: 0;
}

.now-bar.is-idle {
  background: var(--surface-sheen);
  border-left-color: var(--hairline);
}

.now-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1 1 200px;
  min-width: 0;
}

.now-icon {
  color: var(--accent, var(--color-text-muted));
  flex-shrink: 0;
}

.now-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1 1 120px;
}

.now-label {
  font-weight: 650;
  min-width: 0;
}

.now-desc {
  color: var(--color-text-muted);
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.now-elapsed {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-weight: 650;
  font-size: 1.0625rem;
  letter-spacing: 0.02em;
  flex-shrink: 0;
  white-space: nowrap;
  color: var(--accent, var(--color-text));
}

.now-bar.is-idle .now-elapsed {
  color: var(--color-text);
}

.now-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-left: auto;
}

.now-actions .btn-action,
.now-actions .btn-primary {
  min-height: 40px;
}

.now-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1 1 160px;
  min-width: 0;
}

.now-idle {
  color: var(--color-text-muted);
}

.now-stale {
  flex: 1 1 100%;
  margin: 0;
  font-size: 0.8125rem;
  color: var(--color-danger-text);
}

@media (max-width: 767px) {
  .now-bar {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    row-gap: 6px;
    padding: 8px 10px 8px 12px;
    border-radius: 12px;
  }

  .now-bar.is-idle {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    column-gap: 8px;
  }

  .now-head {
    flex: none;
    display: flex;
  }

  .now-text {
    flex: 1 1 auto;
    min-width: 0;
  }

  .now-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .now-desc {
    display: none;
  }

  .now-actions {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 6px;
    margin-left: 0;
  }

  .now-actions .btn-action,
  .now-actions .btn-primary {
    min-width: 0;
    padding: 0 8px;
  }
}
</style>
