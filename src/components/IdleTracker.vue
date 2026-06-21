<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useMegagrindStore } from '../stores/megagrind'
import { Coffee } from 'lucide-vue-next'

const store = useMegagrindStore()
const timer = ref(0)
const timerInterval = ref<number | null>(null)

const isIdle = computed(() => !store.isRunning)
const duration = computed(() => {
  if (isIdle.value) {
    timer.value // trigger reactivity on interval tick
    return store.getCurrentIdleDuration()
  }
  return 0
})

const dailyTotal = computed(() => {
  const dayStart = store.getDayStart()
  const dayEnd = store.getDayEnd()
  return store.getTotalTimeForTypeAndDay('idle', dayStart, dayEnd)
})

const weeklyTotal = computed(() => {
  return store.getTotalTimeForType('idle')
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
  const hours = ms / (60 * 60 * 1000)
  return hours.toFixed(1)
}

function startTimer() {
  if (timerInterval.value) clearInterval(timerInterval.value)
  timerInterval.value = window.setInterval(() => {
    timer.value = Date.now()
  }, 1000)
}

function stopTimer() {
  if (timerInterval.value) {
    clearInterval(timerInterval.value)
    timerInterval.value = null
  }
  timer.value = 0
}

watch(isIdle, (idle) => {
  if (idle) {
    store.initIdle()
    startTimer()
  } else {
    stopTimer()
  }
})

onMounted(() => {
  store.initIdle()
  if (isIdle.value) {
    startTimer()
  }
})

onUnmounted(() => {
  stopTimer()
})
</script>

<template>
  <div class="idle-tracker" :class="{ active: isIdle }">
    <div class="idle-header">
      <Coffee class="idle-icon" />
      <h3>Idle Time</h3>
    </div>

    <div class="timer-display">
      <span v-if="isIdle" class="current-time">{{ formatTime(duration) }}</span>
      <span v-else class="current-time active-label">Active</span>
      <span class="timer-label">{{ isIdle ? 'Currently idle' : 'Session in progress' }}</span>
    </div>

    <div class="stats">
      <div class="stat">
        <span class="stat-value">{{ formatHours(dailyTotal) }}h</span>
        <span class="stat-label">Today</span>
      </div>
      <div class="stat">
        <span class="stat-value">{{ formatHours(weeklyTotal) }}h</span>
        <span class="stat-label">This week</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.idle-tracker {
  background-color: var(--bg-secondary);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='49' viewBox='0 0 28 49'%3E%3Cg fill-rule='evenodd'%3E%3Cg fill='oklch(0.6 0.18 300)' fill-opacity='0.08'%3E%3Cpath d='M13.99 9.25l13 7.5v15l-13 7.5L1 31.75v-15l12.99-7.5zM3 17.9v12.7l10.99 6.34 11-6.35V17.9l-11-6.34L3 17.9zM0 15l12.98-7.5V0h-2v6.35L0 12.69v2.3zm0 18.5L12.98 41v8h-2v-6.85L0 35.81v-2.3zM15 0v7.5L27.99 15H28v-2.31h-.01L17 6.35V0h-2zm0 49v-8l12.99-7.5H28v2.31h-.01L17 42.15V49h-2z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E");
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 1.5rem;
  transition: all 0.3s ease;
  border-left: 3px solid var(--text-muted);
}

.idle-tracker.active {
  border-left: 3px solid var(--accent-yellow);
}

.idle-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.idle-icon {
  width: 24px;
  height: 24px;
  color: var(--accent-yellow);
}

.idle-header h3 {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text-primary);
}

.timer-display {
  text-align: center;
  margin-bottom: 1.5rem;
}

.current-time {
  display: block;
  font-size: 2.5rem;
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  font-feature-settings: 'tnum';
}

@media (max-width: 768px) {
  .idle-tracker {
    padding: 1rem;
  }

  .current-time {
    font-size: 2rem;
  }

  .idle-icon {
    width: 20px;
    height: 20px;
  }

  .idle-header h3 {
    font-size: 1rem;
  }

  .stat-value {
    font-size: 1.125rem;
  }

  .stat-label {
    font-size: 0.6875rem;
  }
}

@media (max-width: 480px) {
  .idle-tracker {
    padding: 0.875rem;
  }

  .current-time {
    font-size: 1.75rem;
  }

  .stats {
    gap: 0.5rem;
  }

  .stat {
    padding: 0.5rem;
  }
}

.timer-label {
  font-size: 0.75rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.stats {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.stat {
  text-align: center;
}

.stat-value {
  display: block;
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.stat-label {
  font-size: 0.75rem;
  color: var(--text-muted);
}

.active-label {
  color: var(--accent-green);
}
</style>
