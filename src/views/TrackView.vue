<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { LayoutGrid, List } from 'lucide-vue-next'
import { useMegagrindStore } from '../stores/megagrind'
import DayRibbon from '../components/DayRibbon.vue'
import { activityLabel } from '../domain/labels'
import { getTrackerConfig } from '../config/trackers'
import type { TrackerType } from '../types'
import type { AddEntryEvent, EntryRef, StartActivityEvent } from '../types/appEvents'
import { favoriteActivities, lastCategory } from '../domain/activities'
import { formatDuration, recentFinishedEntries, todayPresentation } from '../domain/today'
import { isTimeAdjustment } from '../domain/time'

const emit = defineEmits<{
  'start-activity': [event: StartActivityEvent]
  'open-activities': []
  'add-entry': [event: AddEntryEvent]
  'edit-entry': [ref: EntryRef]
}>()

const store = useMegagrindStore()

const favoritesListView = ref(false)

const presentation = computed(() => todayPresentation(store.entries, store.now))
const coveragePct = computed(() => {
  const span = presentation.value.covered + presentation.value.untracked
  return span > 0 ? (presentation.value.covered / span) * 100 : 0
})
const favorites = computed(() => favoriteActivities(store.entries, store.settings.activities))
const recent = computed(() => recentFinishedEntries(store.entries, 5))
const dateLabel = computed(() =>
  new Date(store.now).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }),
)

function labelOf(type: TrackerType): string {
  return activityLabel(type, store.settings.activities)
}

function iconOf(type: TrackerType) {
  return getTrackerConfig(type).icon
}

function accentOf(type: TrackerType): string {
  return getTrackerConfig(type).accent
}

function startFavorite(type: TrackerType) {
  const category = type === 'work' || type === 'chores' ? lastCategory(store.entries, type) : undefined
  emit('start-activity', { type, category })
}

function formatWhen(ms: number): string {
  return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function clockOf(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function entryDuration(e: { start: number; end: number | null }): string {
  return formatDuration((e.end ?? store.now) - e.start)
}
</script>

<template>
  <div class="today" data-test="today-view">
    <header class="page-head">
      <p class="eyebrow">{{ dateLabel }}</p>
      <h1 class="page-title">Today</h1>
    </header>

    <section class="today-summary panel" aria-label="Today summary">
      <dl class="summary-stats stats">
        <div class="stat">
          <dt>Tracked</dt>
          <dd data-test="covered-total">{{ formatDuration(presentation.covered) }}</dd>
        </div>
        <div class="stat">
          <dt>Untracked</dt>
          <dd data-test="untracked-total">{{ formatDuration(presentation.untracked) }}</dd>
        </div>
        <div v-if="presentation.adjustments.length > 0" class="stat">
          <dt>Net recorded time</dt>
          <dd data-test="net-total">{{ formatDuration(presentation.net) }}</dd>
        </div>
        <div v-else-if="presentation.overlap" class="stat">
          <dt>Activity sum (overlaps included)</dt>
          <dd data-test="activity-sum">{{ formatDuration(presentation.normalSum) }}</dd>
        </div>
      </dl>
      <div class="coverage-track" aria-hidden="true">
        <div class="coverage-fill" :style="{ width: coveragePct + '%' }" />
      </div>
      <p v-if="presentation.overlap" class="overlap-warning" role="status" data-test="overlap-warning">
        Recorded activities overlap by {{ formatDuration(presentation.normalSum - presentation.covered) }}.
        Tracked counts each moment once.
      </p>
    </section>

    <section class="today-start" aria-labelledby="today-start-heading">
      <div class="start-head">
        <h2 id="today-start-heading" class="section-heading">Start</h2>
        <button
          type="button"
          class="start-view-toggle"
          data-test="favorite-view-toggle"
          :aria-pressed="favoritesListView"
          :aria-label="favoritesListView ? 'Show favorites as icons' : 'Show favorites as list'"
          :title="favoritesListView ? 'Icon view' : 'List view'"
          @click="favoritesListView = !favoritesListView"
        >
          <component :is="favoritesListView ? LayoutGrid : List" :size="18" aria-hidden="true" />
        </button>
      </div>
      <div v-if="!favoritesListView" class="favorite-icons">
        <button
          v-for="type in favorites"
          :key="type"
          type="button"
          class="favorite-icon"
          data-test="favorite"
          :title="`Start ${labelOf(type)}`"
          :style="{ '--accent': accentOf(type) }"
          @click="startFavorite(type)"
        >
          <component :is="iconOf(type)" :size="22" aria-hidden="true" class="favorite-glyph" />
          <span class="favorite-name">{{ labelOf(type) }}</span>
        </button>
      </div>
      <div v-else class="favorite-grid">
        <button
          v-for="type in favorites"
          :key="type"
          type="button"
          class="btn-action favorite"
          data-test="favorite"
          @click="startFavorite(type)"
        >
          {{ labelOf(type) }}
        </button>
      </div>
      <div class="today-actions">
        <button type="button" class="btn-action" data-test="open-activities" @click="emit('open-activities')">
          All activities
        </button>
        <button type="button" class="btn-action" data-test="add-missed" @click="emit('add-entry', {})">
          Add missed time
        </button>
      </div>
    </section>

    <DayRibbon
      v-if="presentation.segments.length"
      :segments="presentation.segments"
      :day="presentation.day"
      :now="store.now"
    />
    <p v-else class="today-empty" data-test="today-empty">
      Nothing recorded yet today. Start an activity or add missed time.
    </p>

    <section class="today-recent" aria-labelledby="today-recent-heading">
      <h2 id="today-recent-heading" class="section-heading">Recent</h2>
      <ol v-if="recent.length" class="recent-list">
        <li
          v-for="e in recent"
          :key="e.id"
          class="recent-item"
          data-test="recent-item"
          :style="{ '--accent': accentOf(e.type) }"
        >
          <div class="recent-text">
            <span class="recent-label">{{ labelOf(e.type) }}</span>
            <span class="recent-when" data-test="recent-when">{{ formatWhen(e.start) }}, {{ clockOf(e.start) }} to {{ clockOf(e.end ?? e.start) }}</span>
            <span v-if="isTimeAdjustment(e)" class="recent-tag">Correction</span>
            <span v-if="e.description" class="recent-desc">{{ e.description }}</span>
          </div>
          <span class="recent-duration">{{ entryDuration(e) }}</span>
          <button
            type="button"
            class="btn-action"
            data-test="edit-recent"
            :aria-label="`Edit ${labelOf(e.type)} entry`"
            @click="emit('edit-entry', { id: e.id })"
          >
            Edit
          </button>
        </li>
      </ol>
      <p class="recent-history">
        <RouterLink to="/history" class="history-link">All records in History →</RouterLink>
      </p>
    </section>
  </div>
</template>

<style scoped>
.today {
  display: flex;
  flex-direction: column;
  gap: 26px;
  min-width: 0;
  max-width: 780px;
  width: 100%;
  margin: 0 auto;
}

.today-summary {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.summary-stats {
  padding-block: 2px;
}

.coverage-track {
  height: 3px;
  background: var(--control-bg);
  border-top: 1px solid var(--hairline);
}

.coverage-fill {
  height: 100%;
  background: var(--color-primary);
  box-shadow: 0 0 10px color-mix(in oklch, var(--color-primary), transparent 40%);
  transition: width 0.4s ease;
}

.overlap-warning {
  padding: 10px 16px;
  border-top: 1px solid var(--hairline);
  background: color-mix(in oklch, var(--color-danger), transparent 88%);
  color: var(--color-danger-text);
  font-size: 0.875rem;
}

.today-empty {
  color: var(--color-text-muted);
  padding: 14px 16px;
  border: 1px dashed var(--hairline);
  border-radius: var(--radius-control);
  font-size: 0.9375rem;
}

.section-heading {
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  font-weight: 500;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  margin-bottom: 10px;
}

.start-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}

.start-head .section-heading {
  margin-bottom: 0;
}

.start-view-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 36px;
  min-height: 36px;
  padding: 0;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
}

.start-view-toggle:hover,
.start-view-toggle[aria-pressed='true'] {
  color: var(--color-text);
  background: var(--color-surface-raised);
}

.favorite-icons {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(92px, 1fr));
  gap: 8px;
}

.favorite-icon {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 76px;
  padding: 10px 8px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-panel);
  background: var(--surface-sheen);
  color: var(--color-text);
  font: inherit;
  font-size: 0.8125rem;
  cursor: pointer;
  transition: border-color 120ms ease, background 120ms ease, transform 120ms ease;
}

.favorite-glyph {
  color: var(--accent, var(--color-text-muted));
  transition: transform 120ms ease;
}

.favorite-name {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.favorite-icon:hover {
  border-color: var(--accent, var(--color-border));
  background: color-mix(in oklch, var(--accent, var(--color-border)) 12%, var(--color-surface));
  transform: translateY(-1px);
}

.favorite-icon:hover .favorite-glyph {
  transform: scale(1.08);
}

.favorite-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

@media (min-width: 768px) {
  .favorite-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

.today-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}

.recent-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0;
}

.recent-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 10px;
  align-items: center;
  padding: 10px 12px 10px 14px;
  border: 1px solid var(--hairline);
  border-left: 3px solid var(--accent, var(--hairline));
  border-radius: var(--radius-control);
  background: var(--color-surface);
}

.recent-text {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
  min-width: 0;
}

.recent-label {
  font-weight: 650;
}

.recent-when {
  font-family: var(--font-mono);
  font-size: 0.8125rem;
  font-variant-numeric: tabular-nums;
  color: var(--color-text-muted);
}

.recent-tag {
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  border: 1px solid var(--hairline);
  border-radius: 999px;
  padding: 1px 8px;
}

.recent-desc {
  overflow-wrap: anywhere;
  color: var(--color-text-muted);
}

.recent-duration {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-weight: 650;
  white-space: nowrap;
}

.recent-history {
  margin-top: 14px;
}

.history-link {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  color: var(--color-primary);
  text-decoration: none;
  font-weight: 600;
  font-size: 0.9375rem;
}

.history-link:hover {
  text-decoration: underline;
}

@media (max-width: 480px) {
  .recent-item {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .recent-item .btn-action {
    grid-column: 1 / -1;
  }
}
</style>
