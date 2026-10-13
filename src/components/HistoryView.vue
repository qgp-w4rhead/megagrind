<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMegagrindStore } from '../stores/megagrind'
import { dayRange } from '../domain/time'
import { activityLabel } from '../domain/labels'
import { dayBuckets, EMPTY_FILTER, filterEntries, isFilterEmpty, type HistoryFilter } from '../domain/insights'
import type { EntrySlice, TimeEntry } from '../types'
import { getTrackerConfig } from '../config/trackers'
import { activityChoices } from '../domain/activities'
import { Calendar, ChevronLeft, ChevronRight, List, Search, X, Pencil } from 'lucide-vue-next'
import type { AddEntryEvent, EntryRef } from '../types/appEvents'

const emit = defineEmits<{
  'edit-entry': [ref: EntryRef]
  'add-entry': [event: AddEntryEvent]
  'delete-entry': [ref: EntryRef]
}>()

const router = useRouter()
const route = useRoute()
function close() {
  router.push('/')
}

const store = useMegagrindStore()
const currentMonth = ref(new Date())

// --- List-first view + filters (M6.2) ---
// Query params are the deep link from Insights: ?view=list|calendar&type=&category=&q=&day=YYYY-MM-DD
const viewMode = ref<'list' | 'calendar'>(route.query.view === 'calendar' ? 'calendar' : 'list')
const filter = ref<HistoryFilter>({
  text: typeof route.query.q === 'string' ? route.query.q : '',
  type: typeof route.query.type === 'string' ? route.query.type : null,
  category: typeof route.query.category === 'string' ? route.query.category : null,
  from: typeof route.query.from === 'string' ? route.query.from : null,
  to: typeof route.query.to === 'string' ? route.query.to : null,
})
const LIST_LIMIT = 150

const typeOptions = computed(() => activityChoices(store.settings.customChronos, store.entries.map((e) => e.type), store.settings.activities))
const categoryOptions = computed(() => {
  const cats = new Set<string>()
  for (const e of store.entries) if (e.category) cats.add(`${e.type}:${e.category}`)
  return [...cats].sort()
})

const filteredEntries = computed(() => filterEntries(store.entries, filter.value))
// Newest first; bounded so long histories stay responsive.
const listRows = computed(() => {
  const sorted = [...filteredEntries.value].sort((a, b) => b.start - a.start || b.id.localeCompare(a.id))
  return sorted.slice(0, LIST_LIMIT)
})
const hiddenCount = computed(() => Math.max(0, filteredEntries.value.length - listRows.value.length))
const filtering = computed(() => !isFilterEmpty(filter.value))

function selectDayFromList(entry: TimeEntry) {
  selectedDate.value = new Date(dayRange(entry.start).start)
  viewMode.value = 'calendar'
}

watch([viewMode, () => filter.value.text, () => filter.value.type, () => filter.value.category, () => filter.value.from, () => filter.value.to], () => {
  const query: Record<string, string> = {}
  if (viewMode.value === 'calendar') query.view = 'calendar'
  if (filter.value.text.trim()) query.q = filter.value.text.trim()
  if (filter.value.type) query.type = filter.value.type
  if (filter.value.category) query.category = filter.value.category
  if (filter.value.from) query.from = filter.value.from
  if (filter.value.to) query.to = filter.value.to
  router.replace({ path: '/history', query })
})

function clearFilters() {
  filter.value = { ...EMPTY_FILTER }
}

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
  // Single pass over entries instead of a sliceEntries call per day.
  const buckets = dayBuckets(store.entries, {
    start: new Date(year, month, 1).getTime(),
    end: new Date(year, month + 1, 1).getTime(),
  }, store.now)
  for (let i = 1; i <= totalDays; i++) {
    const date = new Date(year, month, i)
    const bucket = buckets.get(dayRange(date.getTime()).start)
    days.push({ day: i, date, types: bucket?.types ?? [], totalMs: bucket?.totalMs ?? 0 })
  }
  return days
})

const monthName = computed(() => {
  return currentMonth.value.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
})

const selectedDate = ref<Date | null>(null)
// Deep link: ?day=YYYY-MM-DD opens that day's details (and the calendar around it).
if (typeof route.query.day === 'string') {
  const parts = route.query.day.split('-').map(Number)
  const y = parts[0], m = parts[1], d = parts[2]
  if (y !== undefined && m !== undefined && d !== undefined && y > 1970 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
    const date = new Date(y, m - 1, d)
    if (!Number.isNaN(date.getTime())) {
      selectedDate.value = date
      currentMonth.value = date
      viewMode.value = 'calendar'
    }
  }
}
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

function isToday(date: Date | null): boolean {
  return date !== null && dayRange(date.getTime()).start === dayRange(store.now).start
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
    const base = activityLabel(entry.type, store.settings.activities)
    const cat = entry.category.charAt(0).toUpperCase() + entry.category.slice(1)
    return `${base} – ${cat}`
  }
  return activityLabel(entry.type, store.settings.activities)
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
    <div class="history-panel panel">
      <div class="history-header">
        <header class="page-head">
          <p class="eyebrow">Every recorded entry</p>
          <h1 class="page-title">History</h1>
        </header>
        <button type="button" class="icon-btn close-btn" aria-label="Close History" @click="close">
          <X class="close-icon" />
        </button>
      </div>

      <div class="history-toolbar">
        <div class="seg view-toggle" role="group" aria-label="History view">
          <button
            type="button"
            class="seg-btn"
            :class="{ active: viewMode === 'list' }"
            :aria-pressed="viewMode === 'list'"
            data-test="view-list"
            @click="viewMode = 'list'"
          ><List :size="15" aria-hidden="true" /> List</button>
          <button
            type="button"
            class="seg-btn"
            :class="{ active: viewMode === 'calendar' }"
            :aria-pressed="viewMode === 'calendar'"
            data-test="view-calendar"
            @click="viewMode = 'calendar'"
          ><Calendar :size="15" aria-hidden="true" /> Month</button>
        </div>
      </div>

      <div v-if="viewMode === 'list'" class="filter-bar" role="search">
        <div class="filter-field">
          <Search :size="14" class="filter-icon" aria-hidden="true" />
          <input
            v-model="filter.text"
            type="search"
            class="filter-input"
            placeholder="Search descriptions, categories…"
            aria-label="Search history"
            data-test="history-search"
          />
        </div>
        <select v-model="filter.type" class="filter-select" aria-label="Filter by activity" data-test="history-type-filter">
          <option :value="null">All activities</option>
          <option v-for="t in typeOptions" :key="t" :value="t">{{ activityLabel(t, store.settings.activities) }}</option>
        </select>
        <label class="filter-date">
          <span class="sr-only">From date</span>
          <input v-model="filter.from" type="date" class="filter-select" aria-label="From date" data-test="history-from" />
        </label>
        <label class="filter-date">
          <span class="sr-only">To date</span>
          <input v-model="filter.to" type="date" class="filter-select" aria-label="To date" data-test="history-to" />
        </label>
        <select v-model="filter.category" class="filter-select" aria-label="Filter by category" data-test="history-category-filter">
          <option :value="null">All categories</option>
          <option v-for="c in categoryOptions" :key="c" :value="c.split(':')[1]">{{ c.split(':')[1] }}</option>
        </select>
        <button v-if="filtering" type="button" class="btn-action clear-btn" data-test="history-clear-filters" @click="clearFilters">
          Clear filters
        </button>
      </div>

      <div v-if="viewMode === 'list'" class="list-view">
        <p v-if="filteredEntries.length === 0" class="no-entries" data-test="history-empty">
          <template v-if="filtering">Nothing matches these filters. <button type="button" class="link-btn" @click="clearFilters">Clear filters</button></template>
          <template v-else>No entries recorded yet.</template>
        </p>
        <template v-else>
          <div
            v-for="entry in listRows"
            :key="entry.id"
            class="entry-item"
            data-test="history-row"
            :style="{ '--accent': dotColor(entry.type) }"
          >
            <div class="entry-left">
              <div class="entry-top-row">
                <button
                  type="button"
                  class="link-btn entry-day-link"
                  :aria-label="`Open ${new Date(entry.start).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`"
                  :data-test="`open-day-${entry.id}`"
                  @click="selectDayFromList(entry)"
                >{{ new Date(entry.start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }} · {{ formatEntryTime(entry) }}</button>
                <span class="entry-label">{{ getEntryLabel(entry) }}</span>
                <span v-if="entry.end === null" class="entry-label running-label">Running</span>
              </div>
              <div v-if="entry.description" class="entry-description">{{ entry.description }}</div>
            </div>
            <div class="entry-right">
              <div class="entry-duration">{{ formatSignedTime((entry.end ?? store.now) - entry.start) }}</div>
              <button type="button" class="btn-action" :aria-label="`Edit ${getEntryLabel(entry)} entry`" data-test="list-edit" @click="emit('edit-entry', { id: entry.id })">
                <Pencil :size="14" aria-hidden="true" />
              </button>
            </div>
          </div>
          <p v-if="hiddenCount > 0" class="no-entries" data-test="history-more">
            {{ hiddenCount }} more entr{{ hiddenCount === 1 ? 'y' : 'ies' }} — narrow with the filters above.
          </p>
        </template>
      </div>

      <template v-if="viewMode === 'calendar'">
      <div class="calendar-controls">
        <button type="button" class="icon-btn" aria-label="Previous month" @click="previousMonth">
          <ChevronLeft class="nav-icon" />
        </button>
        <span class="month-label">{{ monthName }}</span>
        <button type="button" class="icon-btn" aria-label="Next month" @click="nextMonth">
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
            'empty': !day.day,
            'is-today': isToday(day.date)
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
      </template>

      <div v-if="selectedDate && viewMode === 'calendar'" class="day-details">
        <div class="day-details-header">
          <h3>{{ selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) }}</h3>
          <button type="button" class="icon-btn close-details-btn" aria-label="Close day details" @click="selectedDate = null">
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
              :style="{ '--accent': dotColor(item.slice.entry.type) }"
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
  min-width: 0;
}

.history-panel {
  max-width: 780px;
  width: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.history-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 20px 14px;
  border-bottom: 1px solid var(--hairline);
}

.history-header .page-head {
  padding-bottom: 0;
}

.close-icon {
  width: 20px;
  height: 20px;
}

.history-toolbar {
  display: flex;
  justify-content: center;
  padding: 14px 20px 0;
}

.view-toggle {
  width: 100%;
  max-width: 320px;
}

.view-toggle .seg-btn {
  flex: 1;
}

.calendar-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 14px 20px 10px;
}

.nav-icon {
  width: 20px;
  height: 20px;
}

.month-label {
  font-family: var(--font-mono);
  font-size: 0.8125rem;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-text);
}

.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 4px;
  padding: 0 20px 8px;
}

.calendar-day-header {
  text-align: center;
  padding: 0.5rem;
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  font-weight: 500;
  letter-spacing: 0.14em;
  color: var(--color-text-muted);
  text-transform: uppercase;
}

.calendar-day {
  aspect-ratio: 1;
  min-width: 44px;
  min-height: 44px;
  border: 1px solid transparent;
  font: inherit;
  background: transparent;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  border-radius: var(--radius-control);
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
  font-size: 0.875rem;
  color: var(--color-text);
  padding: 2px;
  overflow: hidden;
}

.day-number {
  font-variant-numeric: tabular-nums;
}

.day-total {
  font-family: var(--font-mono);
  font-size: 0.625rem;
  color: var(--color-text-muted);
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
  width: 5px;
  height: 5px;
  border-radius: 50%;
  flex-shrink: 0;
}

.calendar-day.empty {
  cursor: default;
}

.calendar-day:hover:not(.empty):not(.selected) {
  background: var(--color-surface-raised);
}

.calendar-day.has-data {
  background: var(--control-bg);
  border-color: var(--hairline);
}

.calendar-day.has-data:hover:not(.selected) {
  border-color: var(--color-border);
}

.calendar-day.is-today:not(.selected) .day-number {
  color: var(--color-primary);
  font-weight: 700;
}

.calendar-day.is-today:not(.selected) {
  border-color: color-mix(in oklch, var(--color-primary), transparent 55%);
}

.calendar-day.selected {
  background: var(--color-primary);
  color: var(--color-on-primary);
  font-weight: 650;
  border-color: var(--color-primary);
}

.calendar-day.selected .day-total {
  color: var(--color-on-primary);
  opacity: 0.8;
}

.day-details {
  flex: 1;
  padding: 18px 20px 20px;
  border-top: 1px solid var(--hairline);
  overflow-y: auto;
  background: color-mix(in oklch, var(--color-page), transparent 50%);
}

.day-details-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 0.75rem;
}

.day-details-header h3 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 1.125rem;
  font-weight: 650;
  color: var(--color-text);
}

.day-actions {
  margin-bottom: 0.875rem;
}

.no-entries {
  text-align: center;
  padding: 2rem;
  color: var(--color-text-muted);
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
  padding: 0.625rem 0.75rem;
  background: var(--color-surface);
  border: 1px solid var(--hairline);
  border-left: 3px solid var(--accent, var(--hairline));
  border-radius: var(--radius-control);
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
  font-family: var(--font-mono);
  font-size: 0.8125rem;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

.entry-label {
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--accent, var(--color-primary));
  text-transform: uppercase;
  letter-spacing: 0.08em;
  background: color-mix(in oklch, var(--accent, var(--color-primary)) 14%, transparent);
  border: 1px solid color-mix(in oklch, var(--accent, var(--color-primary)) 30%, transparent);
  padding: 0.15rem 0.5rem;
  border-radius: 999px;
}

.entry-description {
  font-size: 0.875rem;
  color: var(--color-text);
  word-break: break-word;
  line-height: 1.4;
}

.entry-right {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.entry-duration {
  font-family: var(--font-mono);
  font-size: 0.875rem;
  color: var(--color-text);
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.gap-item {
  background: transparent;
  border: 1px dashed var(--hairline);
  border-left-style: dashed;
  opacity: 0.75;
}

.gap-label {
  color: var(--color-text-muted);
  background: transparent;
  border: 1px dashed var(--hairline);
}

.gap-duration {
  color: var(--color-text-muted);
}

.delete-entry-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 40px;
  min-height: 40px;
  padding: 0.4rem;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-control);
  color: var(--color-danger-text);
  cursor: pointer;
  transition: background 0.15s ease;
  flex-shrink: 0;
}

.delete-entry-btn:hover {
  background: color-mix(in oklch, var(--color-danger), transparent 80%);
  border-color: color-mix(in oklch, var(--color-danger), transparent 60%);
}

.delete-icon {
  width: 16px;
  height: 16px;
}

.day-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.875rem 1rem;
  background: var(--control-bg);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-control);
}

.summary-label {
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.summary-value {
  font-family: var(--font-mono);
  font-size: 1rem;
  font-weight: 700;
  color: var(--color-primary);
  font-variant-numeric: tabular-nums;
}

.filter-bar {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  padding: 12px 20px;
  border-bottom: 1px solid var(--hairline);
}

.filter-field {
  position: relative;
  flex: 1 1 160px;
  min-width: 0;
  display: flex;
  align-items: center;
}

.filter-icon {
  position: absolute;
  left: 12px;
  color: var(--color-text-muted);
  pointer-events: none;
}

.filter-input {
  width: 100%;
  min-height: 40px;
  padding: 0 10px 0 32px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-control);
  background: var(--control-bg);
  color: var(--color-text);
  font: inherit;
  font-size: 1rem;
}

.filter-input:hover,
.filter-select:hover {
  border-color: var(--color-border);
}

.filter-input:focus,
.filter-select:focus {
  outline: none;
  border-color: var(--color-primary);
}

.filter-select {
  min-height: 40px;
  padding: 0 10px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-control);
  background: var(--control-bg);
  color: var(--color-text);
  font: inherit;
  font-size: 0.875rem;
}

.filter-date {
  display: inline-flex;
  align-items: center;
}

.clear-btn {
  min-height: 40px;
  font-size: 0.8125rem;
}

.list-view {
  padding: 12px 20px 20px;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.link-btn {
  border: none;
  background: none;
  padding: 4px 0;
  font: inherit;
  color: var(--color-primary);
  cursor: pointer;
  text-align: left;
}

.link-btn:hover {
  text-decoration: underline;
}

.entry-day-link {
  font-family: var(--font-mono);
  font-size: 0.8125rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

@media (max-width: 480px) {
  .history-view {
    margin-inline: -14px;
  }

  .filter-bar,
  .list-view {
    padding-inline: 1rem;
  }

  .history-panel {
    border-radius: 0;
    border-left: none;
    border-right: none;
  }

  .calendar-grid {
    gap: 2px;
    padding: 0 8px 6px;
    grid-template-columns: repeat(7, minmax(0, 1fr));
  }

  .calendar-controls {
    gap: 0.75rem;
    padding: 10px 12px;
  }

  .day-details {
    padding: 14px 16px 16px;
  }

  .calendar-day {
    aspect-ratio: auto;
    min-height: 44px;
  }
}
</style>
