<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useMegagrindStore } from '../stores/megagrind'
import { CheckCircle, XCircle, Clock, Coffee, Bell, BellOff } from 'lucide-vue-next'

const store = useMegagrindStore()
const showPrompt = ref(false)
const timeUntilNext = ref(15 * 60 * 1000)
const interval = ref<number | null>(null)

const redCount = computed(() => store.progressCheck.redCount)
const isFocusMode = computed(() => store.progressCheck.focusModeUntil !== null)
const focusModeRemaining = computed(() => {
  if (!store.progressCheck.focusModeUntil) return 0
  return Math.max(0, store.progressCheck.focusModeUntil - Date.now())
})

const shouldShowPrompt = computed(() => {
  if (isFocusMode.value) return false
  if (store.progressCheck.snoozeUntil && store.progressCheck.snoozeUntil > Date.now()) return false
  if (!store.isRunning) return false
  if (store.currentSessionType !== 'work') return false
  return showPrompt.value
})

function formatTime(ms: number): string {
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function handleProgress(madeProgress: boolean) {
  store.recordProgressCheck(madeProgress)
  showPrompt.value = false
  resetTimer()
}

function snooze() {
  store.snoozeProgressCheck()
  showPrompt.value = false
  resetTimer()
}

function resetTimer() {
  timeUntilNext.value = store.settings.progressCheckInterval * 60 * 1000
}

function toggleFocusMode() {
  if (isFocusMode.value) {
    store.disableFocusMode()
  } else {
    store.enableFocusMode()
  }
}

function startTimer() {
  interval.value = window.setInterval(() => {
    if (isFocusMode.value) {
      if (focusModeRemaining.value <= 0) {
        store.disableFocusMode()
      }
      return
    }

    if (store.progressCheck.snoozeUntil && store.progressCheck.snoozeUntil > Date.now()) {
      return
    }

    if (!store.isRunning || store.currentSessionType !== 'work') {
      return
    }

    timeUntilNext.value -= 1000

    if (timeUntilNext.value <= 0) {
      showPrompt.value = true
      sendNotification()
    }
  }, 1000)
}

function sendNotification() {
  if (store.settings.notificationsEnabled && 'Notification' in window) {
    if (Notification.permission === 'granted') {
      new Notification('MEGAGRIND', {
        body: 'Progress check: Did you make progress?',
        icon: '/icon.png',
      })
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission()
    }
  }
}

onMounted(() => {
  startTimer()
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission()
  }
})

onUnmounted(() => {
  if (interval.value) {
    clearInterval(interval.value)
  }
})
</script>

<template>
  <div class="progress-check">
    <div class="progress-header">
      <Clock class="progress-icon" />
      <h3>Progress Check</h3>
      <button class="focus-toggle" :class="{ active: isFocusMode }" @click="toggleFocusMode">
        <Coffee v-if="isFocusMode" class="toggle-icon" />
        <Bell v-else class="toggle-icon" />
        {{ isFocusMode ? 'Focus Mode' : 'Normal' }}
      </button>
    </div>

    <div v-if="isFocusMode" class="focus-info">
      <span class="focus-time">Focus mode: {{ formatTime(focusModeRemaining) }} remaining</span>
    </div>

    <div v-else-if="store.progressCheck.snoozeUntil && store.progressCheck.snoozeUntil > Date.now()" class="snooze-info">
      <span class="snooze-time">Snoozed: {{ formatTime(store.progressCheck.snoozeUntil - Date.now()) }}</span>
    </div>

    <div v-else class="timer-info">
      <span class="next-check">Next check in: {{ formatTime(timeUntilNext) }}</span>
    </div>

    <div class="red-counter">
      <span class="red-count">{{ redCount }}</span>
      <span class="red-label">Reds today</span>
    </div>

    <div v-if="shouldShowPrompt" class="prompt-overlay">
      <div class="prompt-card">
        <h4>Progress Check</h4>
        <p>Did you make progress in the last 15 minutes?</p>
        <div class="prompt-actions">
          <button class="btn-green" @click="handleProgress(true)">
            <CheckCircle class="btn-icon" />
            Yes, Progress
          </button>
          <button class="btn-red" @click="handleProgress(false)">
            <XCircle class="btn-icon" />
            No Progress
          </button>
          <button class="btn-snooze" @click="snooze">Snooze (30min)</button>
        </div>
      </div>
    </div>

    <div v-if="redCount >= 3" class="walk-suggestion">
      <p>⚠️ 3 reds - consider taking a walk</p>
    </div>
  </div>
</template>

<style scoped>
.progress-check {
  background-color: var(--bg-secondary);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='49' viewBox='0 0 28 49'%3E%3Cg fill-rule='evenodd'%3E%3Cg fill='oklch(0.6 0.18 300)' fill-opacity='0.08'%3E%3Cpath d='M13.99 9.25l13 7.5v15l-13 7.5L1 31.75v-15l12.99-7.5zM3 17.9v12.7l10.99 6.34 11-6.35V17.9l-11-6.34L3 17.9zM0 15l12.98-7.5V0h-2v6.35L0 12.69v2.3zm0 18.5L12.98 41v8h-2v-6.85L0 35.81v-2.3zM15 0v7.5L27.99 15H28v-2.31h-.01L17 6.35V0h-2zm0 49v-8l12.99-7.5H28v2.31h-.01L17 42.15V49h-2z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E");
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 1.5rem;
  position: relative;
}

.progress-header {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 1rem;
  position: relative;
}

.progress-header-left {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.progress-icon {
  width: 24px;
  height: 24px;
  color: #fbbf24;
  position: absolute;
  left: 0;
}

.progress-header h3 {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text-primary);
}

.focus-toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  background: var(--bg-tertiary);
  border: 1px solid var(--accent-purple);
  border-radius: 6px;
  color: var(--accent-purple);
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  position: absolute;
  right: 0;
}

.focus-toggle:hover {
  background: var(--bg-hover);
}

.focus-toggle.active {
  background: var(--accent-purple);
  border-color: var(--accent-purple);
  color: var(--bg-primary);
}

.toggle-icon {
  width: 14px;
  height: 14px;
}

.focus-info,
.snooze-info,
.timer-info {
  text-align: center;
  margin-bottom: 1rem;
}

.focus-time,
.snooze-time,
.next-check {
  font-size: 1.5rem;
  font-weight: 700;
  color: #fff;
  font-variant-numeric: tabular-nums;
}

.red-counter {
  text-align: center;
  margin-bottom: 1rem;
}

.red-count {
  display: block;
  font-size: 2rem;
  font-weight: 700;
  color: var(--accent-red);
  font-variant-numeric: tabular-nums;
}

.red-label {
  font-size: 0.75rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.walk-suggestion {
  background: #7c2d12;
  border: 1px solid #9a3412;
  border-radius: 8px;
  padding: 0.75rem;
  text-align: center;
}

.walk-suggestion p {
  margin: 0;
  color: #fed7aa;
  font-size: 0.875rem;
  font-weight: 600;
}

.prompt-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 1rem;
}

.prompt-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 2rem;
  max-width: 400px;
  width: 100%;
}

@media (max-width: 768px) {
  .progress-check {
    padding: 1rem;
  }

  .progress-icon {
    width: 20px;
    height: 20px;
  }

  .progress-header h3 {
    font-size: 1rem;
  }

  .focus-time,
  .snooze-time,
  .next-check {
    font-size: 1.25rem;
  }

  .red-count {
    font-size: 1.75rem;
  }

  .prompt-card {
    padding: 1.5rem;
    max-width: 100%;
  }
}

@media (max-width: 480px) {
  .progress-check {
    padding: 0.875rem;
  }

  .prompt-overlay {
    padding: 0.75rem;
  }

  .prompt-card {
    padding: 1.25rem;
  }

  .prompt-card h4 {
    font-size: 1.125rem;
  }

  .prompt-card p {
    font-size: 0.8125rem;
  }

  .btn-green,
  .btn-red,
  .btn-snooze {
    padding: 0.75rem;
    font-size: 0.8125rem;
  }
}

.prompt-card h4 {
  margin: 0 0 0.5rem 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-primary);
}

.prompt-card p {
  margin: 0 0 1.5rem 0;
  color: var(--text-secondary);
  font-size: 0.875rem;
}

.prompt-actions {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.btn-green,
.btn-red,
.btn-snooze {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.875rem;
  border: none;
  border-radius: 8px;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-green {
  background: var(--accent-green);
  color: var(--bg-primary);
}

.btn-green:hover {
  background: var(--accent-green);
}

.btn-red {
  background: var(--accent-red);
  color: var(--bg-primary);
}

.btn-red:hover {
  background: var(--accent-red);
}

.btn-snooze {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.btn-snooze:hover {
  background: var(--bg-hover);
}

.btn-icon {
  width: 18px;
  height: 18px;
}
</style>
