<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { useMegagrindStore } from '../stores/megagrind'
import DayRibbon from '../components/DayRibbon.vue'
import { activityLabel } from '../domain/labels'
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

const presentation = computed(() => todayPresentation(store.entries, store.now))
const favorites = computed(() => favoriteActivities(store.entries))
const recent = computed(() => recentFinishedEntries(store.entries, 5))
const dateLabel = computed(() =>
  new Date(store.now).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }),
)

function labelOf(type: TrackerType): string {
  return activityLabel(type)
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
    <header class="today-header">
      <p class="today-date">{{ dateLabel }}</p>
      <h1 class="today-title">Today</h1>
    </header>

    <section class="today-summary" aria-label="Today summary">
      <dl class="summary-stats">
        <div>
          <dt>Tracked</dt>
          <dd data-test="covered-total">{{ formatDuration(presentation.covered) }}</dd>
        </div>
        <div>
          <dt>Untracked</dt>
          <dd data-test="untracked-total">{{ formatDuration(presentation.untracked) }}</dd>
        </div>
        <div v-if="presentation.adjustments.length > 0">
          <dt>Net recorded time</dt>
          <dd data-test="net-total">{{ formatDuration(presentation.net) }}</dd>
        </div>
        <div v-else-if="presentation.overlap">
          <dt>Activity sum (overlaps included)</dt>
          <dd data-test="activity-sum">{{ formatDuration(presentation.normalSum) }}</dd>
        </div>
      </dl>
      <p v-if="presentation.overlap" class="overlap-warning" role="status" data-test="overlap-warning">
        Recorded activities overlap by {{ formatDuration(presentation.normalSum - presentation.covered) }}.
        Tracked counts each moment once.
      </p>
    </section>

    <section class="today-start" aria-labelledby="today-start-heading">
      <h2 id="today-start-heading" class="section-heading">Start</h2>
      <div class="favorite-grid">
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

    <DayRibbon v-if="presentation.segments.length" :segments="presentation.segments" />
    <p v-else class="today-empty" data-test="today-empty">
      Nothing recorded yet today. Start an activity or add missed time.
    </p>

    <section class="today-recent" aria-labelledby="today-recent-heading">
      <h2 id="today-recent-heading" class="section-heading">Recent</h2>
      <ol v-if="recent.length" class="recent-list">
        <li v-for="e in recent" :key="e.id" class="recent-item" data-test="recent-item">
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
        <RouterLink to="/history">All records in History</RouterLink>
      </p>
    </section>
  </div>
</template>

<style scoped>
.today {
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-width: 0;
  max-width: 760px;
  width: 100%;
  margin: 0 auto;
}

.today-date {
  color: var(--color-text-muted);
  font-size: 0.9375rem;
}

.today-title {
  font-family: var(--font-ui);
  font-size: 1.75rem;
  font-weight: 650;
}

.today-summary {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.summary-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 16px 24px;
}

.summary-stats dt {
  color: var(--color-text-muted);
  font-size: 0.875rem;
}

.summary-stats dd {
  font-family: var(--font-mono);
  font-size: 1.5rem;
  font-variant-numeric: tabular-nums;
}

.overlap-warning {
  padding: 8px 10px;
  border-left: 4px solid var(--color-danger);
  background: var(--color-surface-raised);
  font-size: 0.9375rem;
}

.today-empty {
  color: var(--color-text-muted);
}

.section-heading {
  font-size: 0.9375rem;
  font-weight: 650;
  color: var(--color-text-muted);
  margin-bottom: 8px;
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
  margin-top: 12px;
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
  gap: 8px;
  align-items: center;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--color-surface-raised);
}

.recent-text {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  min-width: 0;
}

.recent-label {
  font-weight: 600;
}

.recent-tag {
  font-size: 0.8125rem;
  color: var(--color-text-muted);
}

.recent-desc {
  overflow-wrap: anywhere;
  color: var(--color-text-muted);
}

.recent-duration {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}

.recent-history {
  margin-top: 12px;
}

.recent-history a {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  color: var(--color-primary);
  text-decoration: underline;
  font-weight: 600;
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
