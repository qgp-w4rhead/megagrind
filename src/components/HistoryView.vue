<script setup lang="ts">
import { ref, computed } from 'vue'
import { useMegagrindStore } from '../stores/megagrind'
import { TRACKER_LABELS } from '../types'
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-vue-next'

const props = defineProps<{
  show: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const store = useMegagrindStore()
const currentMonth = ref(new Date())

const daysInMonth = computed(() => {
  const year = currentMonth.value.getFullYear()
  const month = currentMonth.value.getMonth()
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const startDay = firstDay.getDay()
  const totalDays = lastDay.getDate()
  
  const days = []
  for (let i = 0; i < startDay; i++) {
    days.push({ day: null, hasData: false })
  }
  for (let i = 1; i <= totalDays; i++) {
    const date = new Date(year, month, i)
    const dayStart = new Date(year, month, i).setHours(0, 0, 0, 0)
    const dayEnd = new Date(year, month, i).setHours(23, 59, 59, 999)
    const hasWorkData = store.entries.some(
      (e) => e.type === 'work' && e.start >= dayStart && e.start <= dayEnd
    )
    days.push({ day: i, date, hasData: hasWorkData })
  }
  return days
})

const monthName = computed(() => {
  return currentMonth.value.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
})

const selectedDate = ref<Date | null>(null)
const selectedDayEntries = computed(() => {
  if (!selectedDate.value) return []
  const dayStart = new Date(selectedDate.value).setHours(0, 0, 0, 0)
  const dayEnd = new Date(selectedDate.value).setHours(23, 59, 59, 999)
  return store.entries.filter((e) => e.start >= dayStart && e.start <= dayEnd)
})

function previousMonth() {
  currentMonth.value = new Date(currentMonth.value.getFullYear(), currentMonth.value.getMonth() - 1)
}

function nextMonth() {
  currentMonth.value = new Date(currentMonth.value.getFullYear(), currentMonth.value.getMonth() + 1)
}

function selectDay(day: any) {
  if (day.day) {
    selectedDate.value = day.date
  }
}

function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  return `${minutes}m`
}

function formatEntryTime(entry: any): string {
  const date = new Date(entry.start)
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function getEntryLabel(entry: any): string {
  if ((entry.type === 'work' || entry.type === 'chores') && entry.category) {
    const base = TRACKER_LABELS[entry.type as keyof typeof TRACKER_LABELS] || entry.type
    const cat = entry.category.charAt(0).toUpperCase() + entry.category.slice(1)
    return `${base} – ${cat}`
  }
  return TRACKER_LABELS[entry.type as keyof typeof TRACKER_LABELS] || entry.type
}

function getDayTotal(date: Date): number {
  const dayStart = new Date(date).setHours(0, 0, 0, 0)
  const dayEnd = new Date(date).setHours(23, 59, 59, 999)
  return store.entries
    .filter((e) => e.start >= dayStart && e.start <= dayEnd && e.end)
    .reduce((sum, e) => sum + (e.end! - e.start), 0)
}
</script>

<template>
  <div v-if="show" class="history-overlay">
    <div class="history-panel">
      <div class="history-header">
        <div class="header-left">
          <Calendar class="header-icon" />
          <h2>History</h2>
        </div>
        <button class="close-btn" @click="emit('close')">
          <X class="close-icon" />
        </button>
      </div>

      <div class="calendar-controls">
        <button class="nav-btn" @click="previousMonth">
          <ChevronLeft class="nav-icon" />
        </button>
        <span class="month-label">{{ monthName }}</span>
        <button class="nav-btn" @click="nextMonth">
          <ChevronRight class="nav-icon" />
        </button>
      </div>

      <div class="calendar-grid">
        <div class="calendar-day-header">Sun</div>
        <div class="calendar-day-header">Mon</div>
        <div class="calendar-day-header">Tue</div>
        <div class="calendar-day-header">Wed</div>
        <div class="calendar-day-header">Thu</div>
        <div class="calendar-day-header">Fri</div>
        <div class="calendar-day-header">Sat</div>

        <div
          v-for="(day, index) in daysInMonth"
          :key="index"
          class="calendar-day"
          :class="{
            'has-data': day.hasData,
            'selected': selectedDate && day.date && selectedDate.getTime() === day.date.getTime(),
            'empty': !day.day
          }"
          @click="selectDay(day)"
        >
          <span v-if="day.day" class="day-number">{{ day.day }}</span>
        </div>
      </div>

      <div v-if="selectedDate" class="day-details">
        <div class="day-details-header">
          <h3>{{ selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) }}</h3>
          <button class="close-details-btn" @click="selectedDate = null">
            <X class="close-icon" />
          </button>
        </div>

        <div v-if="selectedDayEntries.length === 0" class="no-entries">
          No entries for this day
        </div>

        <div v-else class="entries-list">
          <div
            v-for="entry in selectedDayEntries"
            :key="entry.id"
            class="entry-item"
          >
            <div class="entry-left">
              <div class="entry-top-row">
                <span class="entry-time">{{ formatEntryTime(entry) }}</span>
                <span class="entry-label">{{ getEntryLabel(entry) }}</span>
              </div>
              <div v-if="entry.description" class="entry-description">
                {{ entry.description }}
              </div>
            </div>
            <div class="entry-duration">{{ formatTime(entry.end! - entry.start) }}</div>
          </div>
        </div>

        <div class="day-summary">
          <span class="summary-label">Total tracked:</span>
          <span class="summary-value">{{ formatTime(getDayTotal(selectedDate)) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.history-overlay {
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

.history-panel {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  max-width: 600px;
  width: 100%;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
}

.history-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.5rem;
  border-bottom: 1px solid var(--border-color);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.header-icon {
  width: 24px;
  height: 24px;
  color: var(--accent-purple);
}

.history-header h2 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-primary);
}

.close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.5rem;
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: 8px;
  transition: color 0.2s ease;
}

.close-btn:hover {
  color: var(--text-primary);
}

.close-icon {
  width: 20px;
  height: 20px;
}

.calendar-controls {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1.5rem;
  padding: 1rem;
}

.nav-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.5rem;
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: 6px;
  transition: color 0.2s ease;
}

.nav-btn:hover {
  color: var(--text-primary);
}

.nav-icon {
  width: 20px;
  height: 20px;
}

.month-label {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
}

.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 0.25rem;
  padding: 0 1.5rem;
}

.calendar-day-header {
  text-align: center;
  padding: 0.5rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
}

.calendar-day {
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 0.875rem;
  color: var(--text-primary);
}

.calendar-day.empty {
  cursor: default;
}

.calendar-day:hover:not(.empty) {
  background: var(--bg-tertiary);
}

.calendar-day.has-data {
  background: var(--bg-tertiary);
  border: 1px solid var(--accent-purple);
}

.calendar-day.selected {
  background: var(--accent-purple);
  color: var(--bg-primary);
  font-weight: 600;
}

.day-details {
  flex: 1;
  padding: 1.5rem;
  border-top: 1px solid var(--border-color);
  overflow-y: auto;
}

.day-details-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
}

.day-details-header h3 {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
}

.close-details-btn {
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

.close-details-btn:hover {
  color: var(--text-primary);
}

.no-entries {
  text-align: center;
  padding: 2rem;
  color: var(--text-muted);
  font-size: 0.875rem;
}

.entries-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.entry-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 0.75rem;
  background: var(--bg-tertiary);
  border-radius: 6px;
  gap: 1rem;
}

.entry-left {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 0;
  flex: 1;
}

.entry-top-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.entry-time {
  font-size: 0.875rem;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.entry-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--accent-purple);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  background: rgba(167, 139, 250, 0.15);
  padding: 0.125rem 0.5rem;
  border-radius: 4px;
}

.entry-description {
  font-size: 0.875rem;
  color: var(--text-primary);
  word-break: break-word;
  line-height: 1.4;
}

.entry-duration {
  font-size: 0.875rem;
  color: var(--accent-green);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  margin-top: 0.125rem;
}

.day-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem;
  background: var(--bg-tertiary);
  border-radius: 8px;
}

.summary-label {
  font-size: 0.875rem;
  color: var(--text-muted);
}

.summary-value {
  font-size: 1rem;
  font-weight: 700;
  color: var(--accent-purple);
  font-variant-numeric: tabular-nums;
}
</style>
