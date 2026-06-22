<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useMegagrindStore } from '../stores/megagrind'
import { WashingMachine, Play, Pause, Plus, X } from 'lucide-vue-next'

const store = useMegagrindStore()
const showForm = ref(false)
const choreCategory = ref(store.settings.choreCategories[0] ?? 'laundry')
const timer = ref(0)
const timerInterval = ref<number | null>(null)

const isRunning = computed(() => store.currentSessionType === 'chores')
const duration = computed(() => {
  if (isRunning.value) {
    timer.value
    return store.getCurrentSessionDuration()
  }
  return 0
})

const dailyTotal = computed(() => {
  const dayStart = store.getDayStart()
  const dayEnd = store.getDayEnd()
  return store.getTotalTimeForTypeAndDay('chores', dayStart, dayEnd)
})

const weeklyTotal = computed(() => {
  return store.getTotalTimeForType('chores')
})

const history = computed(() => {
  const dayStart = store.getDayStart()
  const dayEnd = store.getDayEnd()
  return store.getEntriesByTypeAndDay('chores', dayStart, dayEnd)
})

const currentChoreCategory = computed(() => {
  if (!isRunning.value) return null
  const entry = store.activeSession
  return entry.category ?? null
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
  return (ms / (60 * 60 * 1000)).toFixed(1)
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
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

function startSession() {
  store.startSession('chores', choreCategory.value, choreCategory.value)
  startTimer()
  showForm.value = false
}

function stopSession() {
  store.stopSession()
  stopTimer()
}

function formatEntryTime(entry: any): string {
  const date = new Date(entry.start)
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function getEntryCategoryLabel(entry: any): string | null {
  if (entry.category) {
    return entry.category.charAt(0).toUpperCase() + entry.category.slice(1)
  }
  return null
}

function deleteEntry(id: string) {
  store.deleteEntry(id)
}

onMounted(() => {
  if (isRunning.value) startTimer()
})

onUnmounted(() => {
  stopTimer()
})
</script>

<template>
  <div class="chores-tracker">
    <div class="chores-header">
      <WashingMachine class="chores-icon" />
      <h3>Chores</h3>
    </div>

    <div class="timer-display">
      <span class="current-time">{{ formatTime(duration) }}</span>
      <span class="timer-label">
        <template v-if="isRunning && currentChoreCategory">{{ capitalise(currentChoreCategory) }}</template>
        <template v-else>Current session</template>
      </span>
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

    <div v-if="showForm" class="chores-form">
      <select v-model="choreCategory" class="category-select">
        <option v-for="cat in store.settings.choreCategories" :key="cat" :value="cat">
          {{ capitalise(cat) }}
        </option>
      </select>
      <div class="form-actions">
        <button class="btn-secondary" @click="showForm = false">Cancel</button>
        <button class="btn-primary" @click="startSession">Start</button>
      </div>
    </div>

    <div v-else class="chores-actions">
      <button v-if="!isRunning" class="btn-primary" @click="showForm = true">
        <Plus class="btn-icon" />
        New Chore
      </button>
      <button
        v-else
        class="btn-stop"
        @click="stopSession"
      >
        <Pause class="btn-icon" />
        Stop
      </button>
    </div>

    <div v-if="history.length > 0" class="recent-events">
      <div class="recent-events-list">
        <div v-for="entry in history" :key="entry.id" class="recent-event-item">
          <div class="recent-event-left">
            <span class="recent-event-time">{{ formatEntryTime(entry) }}</span>
            <span v-if="getEntryCategoryLabel(entry)" class="recent-event-category">{{ getEntryCategoryLabel(entry) }}</span>
            <span v-if="entry.description" class="recent-event-reason">{{ entry.description }}</span>
          </div>
          <div class="recent-event-right">
            <span class="recent-event-duration">{{ formatTime(entry.end! - entry.start) }}</span>
            <button class="recent-event-remove" @click="deleteEntry(entry.id)" title="Remove">
              <X class="recent-event-x" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chores-tracker {
  background-color: var(--bg-secondary);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='49' viewBox='0 0 28 49'%3E%3Cg fill-rule='evenodd'%3E%3Cg fill='oklch(0.6 0.18 300)' fill-opacity='0.08'%3E%3Cpath d='M13.99 9.25l13 7.5v15l-13 7.5L1 31.75v-15l12.99-7.5zM3 17.9v12.7l10.99 6.34 11-6.35V17.9l-11-6.34L3 17.9zM0 15l12.98-7.5V0h-2v6.35L0 12.69v2.3zm0 18.5L12.98 41v8h-2v-6.85L0 35.81v-2.3zM15 0v7.5L27.99 15H28v-2.31h-.01L17 6.35V0h-2zm0 49v-8l12.99-7.5H28v2.31h-.01L17 42.15V49h-2z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E");
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 1.5rem;
  border-left: 3px solid var(--accent-cyan);
}

.chores-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.chores-icon {
  width: 24px;
  height: 24px;
  color: var(--accent-cyan);
}

.chores-header h3 {
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
  line-height: 1;
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

.chores-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.category-select {
  width: 100%;
  padding: 0.75rem;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  color: var(--text-primary);
  font-size: 1rem;
  min-height: 48px;
}

.category-select:focus {
  outline: none;
  border-color: var(--accent-cyan);
}

.form-actions,
.chores-actions {
  display: flex;
  gap: 0.75rem;
}

.btn-primary,
.btn-secondary,
.btn-stop {
  flex: 1;
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

.btn-primary {
  background: var(--accent-cyan);
  color: var(--bg-primary);
}

.btn-primary:hover {
  background: var(--accent-cyan-hover);
}

.btn-secondary {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.btn-secondary:hover {
  background: var(--bg-hover);
}

.btn-stop {
  background: #dc2626;
  color: var(--text-primary);
}

.btn-stop:hover {
  background: #b91c1c;
}

.btn-icon {
  width: 16px;
  height: 16px;
}

.recent-events {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border-color);
}

.recent-events-list {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  max-height: 120px;
  overflow-y: auto;
}

.recent-event-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.75rem;
  background: var(--bg-tertiary);
  border-radius: 6px;
  gap: 0.5rem;
}

.recent-event-left {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  min-width: 0;
  flex: 1;
}

.recent-event-time {
  font-size: 0.75rem;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.recent-event-category {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--accent-cyan);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  background: rgba(6, 182, 212, 0.15);
  padding: 0.125rem 0.5rem;
  border-radius: 4px;
  white-space: nowrap;
}

.recent-event-reason {
  font-size: 0.75rem;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recent-event-right {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
}

.recent-event-duration {
  font-size: 0.75rem;
  color: var(--accent-green);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.recent-event-remove {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.125rem;
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.2s ease;
}

.recent-event-remove:hover {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.15);
}

.recent-event-x {
  width: 14px;
  height: 14px;
}

@media (max-width: 768px) {
  .chores-tracker {
    padding: 1rem;
  }

  .current-time {
    font-size: 2rem;
  }

  .chores-icon {
    width: 20px;
    height: 20px;
  }

  .chores-header h3 {
    font-size: 1rem;
  }

  .stat-value {
    font-size: 1rem;
  }

  .category-select {
    padding: 0.75rem;
    font-size: 1rem;
    min-height: 48px;
  }
}

@media (max-width: 480px) {
  .chores-tracker {
    padding: 0.875rem;
  }

  .current-time {
    font-size: 1.75rem;
  }

  .stats {
    grid-template-columns: 1fr;
    gap: 0.5rem;
  }

  .stat {
    padding: 0.5rem;
  }

  .btn-primary,
  .btn-secondary,
  .btn-stop {
    padding: 0.75rem;
    font-size: 0.9375rem;
    min-height: 48px;
  }
}
</style>