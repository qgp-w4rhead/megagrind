<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useMegagrindStore } from '../stores/megagrind'
import type { TrackerType } from '../types'
import { TRACKER_LABELS } from '../types'
import { Moon, Utensils, Droplets, WashingMachine, Clock, Footprints, Wine, AlertTriangle, Briefcase, Play, Pause, Plus, Trash2, Edit2, History, X } from 'lucide-vue-next'

const props = defineProps<{
  type: TrackerType
}>()

const store = useMegagrindStore()
const timer = ref(0)
const timerInterval = ref<number | null>(null)
const showHistory = ref(false)
const showManualEntry = ref(false)
const manualStartTime = ref('')
const manualEndTime = ref('')
const manualDuration = ref('')
const sessionDescription = ref('')
const manualDescription = ref('')

const isRunning = computed(() => store.currentSessionType === props.type)
const duration = computed(() => {
  if (isRunning.value) {
    timer.value // trigger reactivity on interval tick
    return store.getCurrentSessionDuration()
  }
  return 0
})

const dailyTotal = computed(() => {
  const dayStart = store.getDayStart()
  const dayEnd = store.getDayEnd()
  return store.getTotalTimeForTypeAndDay(props.type, dayStart, dayEnd)
})

const weeklyTotal = computed(() => {
  return store.getTotalTimeForType(props.type)
})

const allowance = computed(() => {
  const allocations = store.settings.weeklyAllocations as Record<string, number>
  const allocation = allocations[props.type] ?? 0
  return allocation * 60 * 60 * 1000
})

const history = computed(() => {
  const dayStart = store.getDayStart()
  const dayEnd = store.getDayEnd()
  return store.getEntriesByTypeAndDay(props.type, dayStart, dayEnd)
})

const status = computed(() => {
  const diff = weeklyTotal.value - allowance.value
  if (diff > 0) return 'over'
  if (diff < -3600000) return 'behind'
  return 'on-track'
})

const icon = computed(() => {
  const icons: Record<string, any> = {
    sleep: Moon,
    cook: Utensils,
    shower: Droplets,
    chores: WashingMachine,
    move: Footprints,
    leisure: Wine,
    unexpected: AlertTriangle,
    work: Briefcase,
  }
  return icons[props.type] ?? Clock
})

const label = computed(() => {
  return TRACKER_LABELS[props.type] || props.type.charAt(0).toUpperCase() + props.type.slice(1)
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

function toggleTracker() {
  if (isRunning.value) {
    store.stopSession()
    stopTimer()
    sessionDescription.value = ''
  } else {
    if (props.type === 'unexpected' && !sessionDescription.value.trim()) return
    store.startSession(props.type, sessionDescription.value.trim() || undefined)
    startTimer()
  }
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

function deleteEntry(id: string) {
  store.deleteEntry(id)
}

function addManualEntry() {
  const durationMs = parseFloat(manualDuration.value) * 60 * 1000
  if (isNaN(durationMs) || durationMs === 0) return

  const now = Date.now()
  
  // Both start and end should be at current time
  // The duration is stored as the difference (end - start)
  // Negative duration means end < start (correction)
  const startTime = now
  const endTime = now + durationMs

  const description = props.type === 'unexpected' && manualDescription.value.trim()
    ? manualDescription.value.trim()
    : undefined

  store.addManualEntry({
    type: props.type,
    start: startTime,
    end: endTime,
    description,
  })

  manualDuration.value = ''
  manualDescription.value = ''
  showManualEntry.value = false
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

onMounted(() => {
  if (isRunning.value) {
    startTimer()
  }
})

onUnmounted(() => {
  stopTimer()
})
</script>

<template>
  <div class="tracker-card" :class="status">
    <div class="tracker-header">
      <div class="tracker-header-left">
        <component :is="icon" class="tracker-icon" />
        <h3>{{ label }}</h3>
      </div>
      <div class="header-actions">
        <button class="icon-btn" @click="showHistory = !showHistory" title="History">
          <History class="action-icon" />
        </button>
        <button class="icon-btn" @click="showManualEntry = true" title="Add manual entry">
          <Plus class="action-icon" />
        </button>
      </div>
    </div>

    <div class="timer-display">
      <span class="current-time">{{ formatTime(duration) }}</span>
      <span class="timer-label">Current session</span>
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
      <div class="stat">
        <span class="stat-value" :class="status">
          {{ weeklyTotal > allowance ? '+' : '' }}{{ formatHours(weeklyTotal - allowance) }}h
        </span>
        <span class="stat-label">vs allowance</span>
      </div>
    </div>

    <div v-if="type === 'unexpected' && !isRunning" class="unexpected-input">
      <input
        v-model="sessionDescription"
        type="text"
        placeholder="What came up?"
        class="description-input"
      />
    </div>

    <div v-if="type === 'unexpected' && isRunning && sessionDescription" class="unexpected-reason">
      {{ sessionDescription }}
    </div>

    <button class="toggle-btn" :class="{ running: isRunning, 'needs-reason': type === 'unexpected' && !isRunning && !sessionDescription.trim() }" @click="toggleTracker">
      <Play v-if="!isRunning" class="btn-icon" />
      <Pause v-else class="btn-icon" />
      {{ isRunning ? 'Stop' : 'Start' }}
    </button>

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

    <div v-if="showHistory" class="history-panel">
      <div class="history-header">
        <h4>Today's History</h4>
        <button class="close-btn" @click="showHistory = false">
          <X class="close-icon" />
        </button>
      </div>
      <div v-if="history.length === 0" class="empty-history">
        No entries today
      </div>
      <div v-else class="history-list">
        <div v-for="entry in history" :key="entry.id" class="history-item">
          <span class="history-time">{{ formatEntryTime(entry) }}</span>
          <span class="history-duration">{{ formatTime(entry.end! - entry.start) }}</span>
          <button class="delete-btn" @click="deleteEntry(entry.id)" title="Delete">
            <Trash2 class="delete-icon" />
          </button>
        </div>
      </div>
    </div>

    <div v-if="showManualEntry" class="manual-entry-panel">
      <div class="manual-entry-header">
        <h4>Add Manual Entry</h4>
        <button class="close-btn" @click="showManualEntry = false">
          <X class="close-icon" />
        </button>
      </div>
      <div class="manual-entry-form">
        <div class="form-group">
          <label>DURATION / REASON</label>
          <input
            v-model.number="manualDuration"
            type="number"
            step="1"
            placeholder="e.g., 30 or -15"
          />
        </div>
        <div v-if="type === 'unexpected'" class="form-group">
          <input
            v-model="manualDescription"
            type="text"
            placeholder="What came up?"
          />
        </div>
        <div class="form-actions">
          <button class="btn-cancel" @click="showManualEntry = false">Cancel</button>
          <button class="btn-add" @click="addManualEntry">Add Entry</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tracker-card {
  background-color: var(--bg-secondary);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='49' viewBox='0 0 28 49'%3E%3Cg fill-rule='evenodd'%3E%3Cg fill='oklch(0.6 0.18 300)' fill-opacity='0.08'%3E%3Cpath d='M13.99 9.25l13 7.5v15l-13 7.5L1 31.75v-15l12.99-7.5zM3 17.9v12.7l10.99 6.34 11-6.35V17.9l-11-6.34L3 17.9zM0 15l12.98-7.5V0h-2v6.35L0 12.69v2.3zm0 18.5L12.98 41v8h-2v-6.85L0 35.81v-2.3zM15 0v7.5L27.99 15H28v-2.31h-.01L17 6.35V0h-2zm0 49v-8l12.99-7.5H28v2.31h-.01L17 42.15V49h-2z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E");
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 1.5rem;
  transition: all 0.3s ease;
}

.tracker-card:hover {
  border-color: #4a4a7e;
  transform: translateY(-2px);
}

.tracker-card.on-track {
  border-left: 3px solid var(--accent-green);
}

.tracker-card.over {
  border-left: 3px solid var(--accent-red);
}

.tracker-card.behind {
  border-left: 3px solid var(--accent-yellow);
}

.tracker-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
}

.tracker-header-left {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.tracker-icon {
  width: 24px;
  height: 24px;
  color: var(--accent-purple);
}

.tracker-header h3 {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text-primary);
}

.header-actions {
  display: flex;
  gap: 0.5rem;
}

.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.375rem;
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.2s ease;
  min-width: 44px;
  min-height: 44px;
}

.action-icon {
  width: 16px;
  height: 16px;
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
  grid-template-columns: repeat(3, 1fr);
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

.stat-value.on-track {
  color: var(--accent-green);
}

.stat-value.over {
  color: var(--accent-red);
}

.stat-value.behind {
  color: var(--accent-yellow);
}

.stat-label {
  font-size: 0.75rem;
  color: var(--text-muted);
}

.toggle-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.875rem;
  background: var(--bg-tertiary);
  border: none;
  border-radius: 8px;
  color: var(--text-primary);
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  min-height: 48px;
}

.toggle-btn:hover {
  background: var(--bg-hover);
}

.toggle-btn.running {
  background: #dc2626;
}

.toggle-btn.running:hover {
  background: #b91c1c;
}

.toggle-btn.needs-reason {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-icon {
  width: 18px;
  height: 18px;
}

.unexpected-input {
  margin-bottom: 0.75rem;
}

.description-input {
  width: 100%;
  padding: 0.75rem;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  color: var(--text-primary);
  font-size: 1rem;
  min-height: 48px;
}

.description-input:focus {
  outline: none;
  border-color: var(--accent-yellow);
}

.description-input::placeholder {
  color: var(--text-muted);
}

.unexpected-reason {
  margin-bottom: 0.75rem;
  padding: 0.5rem 0.75rem;
  background: var(--bg-tertiary);
  border: 1px solid var(--accent-yellow);
  border-radius: 6px;
  color: var(--accent-yellow);
  font-size: 0.875rem;
  font-weight: 500;
}

.history-panel,
.manual-entry-panel {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border-color);
}

.history-header,
.manual-entry-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
}

.history-header h4,
.manual-entry-header h4 {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
}

.close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.25rem;
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: 4px;
  transition: color 0.2s ease;
}

.close-btn:hover {
  color: var(--text-primary);
}

.close-icon {
  width: 16px;
  height: 16px;
}

.empty-history {
  text-align: center;
  padding: 1rem;
  color: var(--text-muted);
  font-size: 0.875rem;
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.history-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.75rem;
  background: var(--bg-tertiary);
  border-radius: 6px;
}

.history-time {
  font-size: 0.875rem;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.history-duration {
  font-size: 0.875rem;
  color: var(--accent-purple);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.delete-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.25rem;
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: 4px;
  transition: color 0.2s ease;
}

.delete-btn:hover {
  color: var(--accent-red);
}

.delete-icon {
  width: 14px;
  height: 14px;
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
  padding-right: 0.5rem;
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
  color: var(--accent-purple);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  background: rgba(167, 139, 250, 0.15);
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

.manual-entry-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.form-group label {
  font-size: 0.75rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.form-group input {
  padding: 0.75rem;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  color: var(--text-primary);
  font-size: 1rem;
  min-height: 48px;
}

.form-group input:focus {
  outline: none;
  border-color: var(--accent-purple);
}

.form-actions {
  display: flex;
  gap: 0.5rem;
}

.btn-cancel,
.btn-add {
  flex: 1;
  padding: 0.5rem;
  border: none;
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-cancel {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.btn-cancel:hover {
  background: var(--bg-hover);
}

.btn-add {
  background: var(--accent-purple);
  color: var(--bg-primary);
}

.btn-add:hover {
  background: var(--accent-purple-hover);
}

@media (max-width: 768px) {
  .tracker-card {
    padding: 1rem;
  }

  .current-time {
    font-size: 2rem;
  }

  .stat-value {
    font-size: 1rem;
  }

  .stat-label {
    font-size: 0.6875rem;
  }

  .tracker-header h3 {
    font-size: 1rem;
  }

  .tracker-icon {
    width: 20px;
    height: 20px;
  }
}

@media (max-width: 480px) {
  .tracker-card {
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

  .toggle-btn {
    padding: 0.75rem;
    font-size: 0.9375rem;
  }
}
</style>
