<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useMegagrindStore } from '../stores/megagrind'
import { dayRange } from '../domain/time'
import { activityLabel } from '../domain/labels'
import type { EntrySlice, TimeEntry } from '../types'
import { getTrackerConfig } from '../config/trackers'
import { Calendar, ChevronLeft, ChevronRight, X, Pencil } from 'lucide-vue-next'
import type { AddEntryEvent, EntryRef } from '../types/appEvents'

const emit = defineEmits<{
  'edit-entry': [ref: EntryRef]
  'add-entry': [event: AddEntryEvent]
  'delete-entry': [ref: EntryRef]
}>()

const router = useRouter()
function close() {
  router.push('/')
}

const store = useMegagrindStore()
const currentMonth = ref(new Date())

const DAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Weekday column headers rotated so the first column is the rollover day.
const weekHeaders = computed(() => {
  const start = store.settings.weekRolloverDay
  return [...DAY_HEADERS.slice(start), ...DAY_HEADERS.slice(0, start)]
})

interface DayCell {
  day: number | null
  date: Date | null
  types: string[]
  totalMs: number
}

const daysInMonth = computed<DayCell[]>(() => {
  const year = currentMonth.value.getFullYear()
  const month = currentMonth.value.getMonth()
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const totalDays = lastDay.getDate()
  // Leading blanks so week rows start on the configured rollover day.
  const startDay =
    (firstDay.getDay() - store.settings.weekRolloverDay + 7) % 7

  const days: DayCell[] = []
  for (let i = 0; i < startDay; i++) {
    days.push({ day: null, date: null, types: [], totalMs: 0 })
  }
  for (let i = 1; i <= totalDays; i++) {
    const date = new Date(year, month, i)
    const range = dayRange(date.getTime())
    // Aggregate every tracked type — not just work.
    const types = [...new Set(store.getEntrySlices(range).map((s) => s.entry.type))]
    const totalMs = store.getTotalTimeForRange(range)
    days.push({ day: i, date, types, totalMs })
  }
  return days
})

const monthName = computed(() => {
  return currentMonth.value.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
})

const selectedDate = ref<Date | null>(null)
const selectedDayEntries = computed<EntrySlice[]>(() => {
  if (!selectedDate.value) return []
  return store.getEntrySlices(dayRange(selectedDate.value.getTime()))
})

type TimelineItem =
  | { kind: 'entry'; slice: EntrySlice }
  | { kind: 'gap'; start: number; end: number }

// Chronological timeline of the day's entries with untracked gaps
// interleaved between consecutive entries.
const dayTimeline = computed<TimelineItem[]>(() => {
  const sorted = [...selectedDayEntries.value].sort((a, b) => a.start - b.start)
  const items: TimelineItem[] = []
  let prevEnd: number | null = null
  for (const slice of sorted) {
    if (slice.isAdjustment) {
      items.push({ kind: 'entry', slice })
      continue
    }
    if (prevEnd !== null && slice.start > prevEnd) {
      items.push({ kind: 'gap', start: prevEnd, end: slice.start })
    }
    items.push({ kind: 'entry', slice })
    prevEnd = Math.max(prevEnd ?? slice.end, slice.end)
  }
  return items
})

function dotColor(type: string): string {
  return getTrackerConfig(type as TimeEntry['type']).accent
}

function formatDayTotal(ms: number): string {
  const h = ms / 3600000
  if (h >= 1) return `${Number.isInteger(h) ? h : h.toFixed(1)}h`
  return `${Math.round(ms / 60000)}m`
}

function previousMonth() {
  currentMonth.value = new Date(currentMonth.value.getFullYear(), currentMonth.value.getMonth() - 1)
}

function nextMonth() {
  currentMonth.value = new Date(currentMonth.value.getFullYear(), currentMonth.value.getMonth() + 1)
}

function selectDay(day: DayCell) {
  if (day.day) {
    selectedDate.value = day.date
  }
}

function dayAriaLabel(date: Date, totalMs: number): string {
  const day = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  return totalMs > 0 ? `${day}, ${formatDayTotal(totalMs)} recorded` : `${day}, nothing recorded`
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

function formatEntryTime(entry: Pick<TimeEntry, 'start'>): string {
  const date = new Date(entry.start)
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function getEntryLabel(entry: TimeEntry): string {
  if ((entry.type === 'work' || entry.type === 'chores') && entry.category) {
    const base = activityLabel(entry.type)
    const cat = entry.category.charAt(0).toUpperCase() + entry.category.slice(1)
    return `${base} – ${cat}`
  }
  return activityLabel(entry.type)
}

function formatSignedTime(ms: number): string {
  return ms < 0 ? `-${formatTime(-ms)}` : formatTime(ms)
}

function getDayTotal(date: Date): number {
  return store.getTotalTimeForRange(dayRange(date.getTime()))
}

function deleteEntry(entryId: string) {
  emit('delete-entry', { id: entryId })
}
</script>

<template>
  <div class="history-view">
    <div class="history-panel">
      <div class="history-header">
        <div class="header-left">
          <Calendar class="header-icon" />
          <h2>History</h2>
        </div>
        <button type="button" class="close-btn" aria-label="Close History" @click="close">
          <X class="close-icon" />
        </button>
      </div>

      <div class="calendar-controls">
        <button type="button" class="nav-btn" aria-label="Previous month" @click="previousMonth">
          <ChevronLeft class="nav-icon" />
        </button>
        <span class="month-label">{{ monthName }}</span>
        <button type="button" class="nav-btn" aria-label="Next month" @click="nextMonth">
          <ChevronRight class="nav-icon" />
        </button>
      </div>

      <div class="calendar-grid">
        <div
          v-for="header in weekHeaders"
          :key="header"
          class="calendar-day-header"
        >
          {{ header }}
        </div>

        <button
          v-for="(day, index) in daysInMonth"
          :key="index"
          type="button"
          class="calendar-day"
          :class="{
            'has-data': day.types.length > 0,
            'selected': selectedDate && day.date && selectedDate.getTime() === day.date.getTime(),
            'empty': !day.day
          }"
          :data-test="day.day ? `day-${day.day}` : 'day-blank'"
          :disabled="!day.day"
          :tabindex="day.day ? undefined : -1"
          :aria-hidden="day.day ? undefined : 'true'"
          :aria-label="day.date ? dayAriaLabel(day.date, day.totalMs) : undefined"
          :aria-pressed="day.date ? (selectedDate && selectedDate.getTime() === day.date.getTime() ? 'true' : 'false') : undefined"
          @click="selectDay(day)"
        >
          <template v-if="day.day">
            <span class="day-number">{{ day.day }}</span>
            <span v-if="day.totalMs > 0" class="day-total">{{ formatDayTotal(day.totalMs) }}</span>
            <span v-if="day.types.length" class="day-dots">
              <span
                v-for="t in day.types"
                :key="t"
                class="day-dot"
                :data-test="`dot-${t}`"
                :style="{ background: dotColor(t) }"
              />
            </span>
          </template>
        </button>
      </div>

      <div v-if="selectedDate" class="day-details">
        <div class="day-details-header">
          <h3>{{ selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) }}</h3>
          <button class="close-details-btn" @click="selectedDate = null">
            <X class="close-icon" />
          </button>
        </div>

        <div class="day-actions">
          <button type="button" class="btn-action" data-test="history-add-entry" @click="emit('add-entry', {})">
            Add missed time
          </button>
        </div>

        <div v-if="selectedDayEntries.length === 0" class="no-entries">
          No entries for this day
        </div>

        <div v-else class="entries-list">
          <template v-for="item in dayTimeline" :key="item.kind === 'entry' ? item.slice.entry.id : `gap-${item.start}`">
            <div
              v-if="item.kind === 'gap'"
              class="entry-item gap-item"
              data-test="timeline-gap"
            >
              <div class="entry-left">
                <span class="entry-time">{{ formatEntryTime({ start: item.start }) }}</span>
                <span class="entry-label gap-label">Untracked</span>
              </div>
              <div class="entry-right">
                <div class="entry-duration gap-duration">{{ formatTime(item.end - item.start) }}</div>
              </div>
            </div>
            <div
              v-else
              class="entry-item"
              data-test="timeline-entry"
              :data-entry-id="item.slice.entry.id"
            >
              <div class="entry-left">
                <div class="entry-top-row">
                  <span class="entry-time">{{ formatEntryTime(item.slice) }}</span>
                  <span class="entry-label">{{ getEntryLabel(item.slice.entry) }}</span>
                  <span v-if="item.slice.isAdjustment" class="entry-label adjustment-label">Adjustment</span>
                  <span v-if="item.slice.isRunning" class="entry-label running-label">Running</span>
                </div>
                <div v-if="item.slice.entry.description" class="entry-description">
                  {{ item.slice.entry.description }}
                </div>
              </div>
              <div class="entry-right">
                <div class="entry-duration" data-test="entry-duration">{{ formatSignedTime(item.slice.duration) }}</div>
                <button type="button" class="btn-action" data-test="edit-history-entry" :aria-label="`Edit ${getEntryLabel(item.slice.entry)} entry`" @click="emit('edit-entry', { id: item.slice.entry.id })">
                  <Pencil :size="14" aria-hidden="true" />
                </button>
                <button type="button" class="delete-entry-btn" :aria-label="`Delete ${getEntryLabel(item.slice.entry)} entry`" @click="deleteEntry(item.slice.entry.id)" title="Delete entry">
                  <X class="delete-icon" />
                </button>
              </div>
            </div>
          </template>
        </div>

        <div class="day-summary">
          <span class="summary-label">Total tracked:</span>
          <span class="summary-value">{{ formatSignedTime(getDayTotal(selectedDate)) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.history-view {
  display: flex;
  justify-content: center;
  padding: 1rem;
}

.history-panel {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  max-width: 720px;
  width: 100%;
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
  min-width: 44px;
  min-height: 44px;
  border: none;
  font: inherit;
  background: transparent;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 0.875rem;
  color: var(--text-primary);
  padding: 2px;
  overflow: hidden;
}

.day-total {
  font-size: 0.6rem;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.day-dots {
  display: flex;
  gap: 3px;
  justify-content: center;
  flex-wrap: wrap;
  max-width: 100%;
}

.day-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
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

.entry-right {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.entry-duration {
  font-size: 0.875rem;
  color: var(--accent-green);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.gap-item {
  background: transparent;
  border: 1px dashed var(--border-color);
  opacity: 0.7;
}

.gap-label {
  color: var(--text-muted);
  background: transparent;
  border: 1px dashed var(--border-color);
}

.gap-duration {
  color: var(--text-muted);
}

.delete-entry-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.25rem;
  background: transparent;
  border: none;
  color: #ef4444;
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.delete-entry-btn:hover {
  background: rgba(239, 68, 68, 0.15);
}

.delete-icon {
  width: 18px;
  height: 18px;
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
@media (max-width: 480px) {
  .history-view {
    margin-inline: -14px;
    padding: 0;
  }

  .history-panel {
    border-radius: 0;
    border-left: none;
    border-right: none;
  }

  .calendar-grid {
    gap: 0;
    padding: 0;
    grid-template-columns: repeat(7, minmax(0, 1fr));
  }

  .calendar-controls {
    gap: 0.75rem;
    padding: 0.75rem;
  }

  .day-details {
    padding: 1rem;
  }

  .calendar-day {
    aspect-ratio: auto;
    min-height: 44px;
  }
}
</style>
