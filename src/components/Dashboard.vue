<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useMegagrindStore } from '../stores/megagrind'
import { activityLabel } from '../domain/labels'
import {
  categoryTotals,
  comparisonFor,
  coverageOf,
  effectiveEnd,
  goalProgressForPeriod,
  isCurrentPeriod,
  periodRange,
  shiftPeriodAnchor,
  typeTotals,
  type GoalProgress,
  type PeriodKind,
} from '../domain/insights'
import { GOAL_POLICY_LABELS } from '../domain/goals'
import ProgressCheckDetails from './ProgressCheckDetails.vue'
import { getTrackerConfig } from '../config/trackers'
import { ChevronLeft, ChevronRight, Clock } from 'lucide-vue-next'

defineOptions({ name: 'InsightsDashboard' })

const store = useMegagrindStore()
const router = useRouter()

const periodKind = ref<PeriodKind>('week')
const anchor = ref(store.now)

const range = computed(() =>
  periodRange(periodKind.value, anchor.value, store.settings.weekRolloverDay, store.settings.weekRolloverHour),
)
const isCurrent = computed(() => isCurrentPeriod(range.value, store.now))
const end = computed(() => effectiveEnd(range.value, store.now))

const slices = computed(() => store.getEntrySlices(range.value))
const totals = computed(() => typeTotals(slices.value))
const categories = computed(() => categoryTotals(slices.value))
const coverage = computed(() => coverageOf(slices.value, range.value, store.now))
const goals = computed(() => goalProgressForPeriod(store.settings.goals ?? {}, totals.value))

const comparison = computed(() =>
  comparisonFor(periodKind.value, range.value, store.now, store.settings.weekRolloverDay, store.settings.weekRolloverHour),
)
const prevTotals = computed(() => {
  const map = new Map<string, number>()
  for (const t of typeTotals(store.getEntrySlices(comparison.value.compareRange))) map.set(t.type, t.totalMs)
  return map
})
const prevTotalMs = computed(() => [...prevTotals.value.values()].reduce((a, b) => a + b, 0))
const totalMs = computed(() => totals.value.reduce((a, t) => a + t.totalMs, 0))
const deltaMs = computed(() => totalMs.value - prevTotalMs.value)

const activityName = (id: string) => activityLabel(id, store.settings.activities)
const accentOf = (id: string) => getTrackerConfig(id as Parameters<typeof getTrackerConfig>[0]).accent

const periodLabel = computed(() => {
  const s = new Date(range.value.start)
  const e = new Date(range.value.end - 1)
  if (periodKind.value === 'day') {
    return s.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
  }
  const sameMonth = s.getMonth() === e.getMonth()
  return `${s.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${e.toLocaleDateString(undefined, { month: sameMonth ? undefined : 'short', day: 'numeric', year: 'numeric' })}`
})

const periodContext = computed(() =>
  isCurrent.value ? 'so far' : 'completed',
)

const checksAvailable = computed(() => {
  const started = store.progressHistoryStartedAt
  if (started === null) return false
  return started < end.value
})

const checkEvents = computed(() =>
  store.progressEvents.filter((ev) => ev.at >= range.value.start && ev.at < end.value),
)
const checkCounts = computed(() => {
  const counts = { progress: 0, blocked: 0, snoozed: 0, skipped: 0 }
  for (const ev of checkEvents.value) counts[ev.outcome] += 1
  return counts
})
// Consecutive blocked streak within the selected period — distinct from totals.
const blockedStreak = computed(() => {
  let streak = 0
  let best = 0
  for (const ev of checkEvents.value) {
    if (ev.outcome === 'blocked') {
      streak += 1
      best = Math.max(best, streak)
    } else if (ev.outcome === 'progress' || ev.outcome === 'snoozed' || ev.outcome === 'skipped') {
      streak = 0
    }
  }
  return best
})

function formatHours(ms: number): string {
  return (Math.abs(ms) / 3600000).toFixed(1)
}

function goalLine(g: GoalProgress): string {
  const actual = formatHours(g.actualMs)
  if (g.policy === 'budget') {
    return g.state === 'over'
      ? `${actual}h used — ${formatHours(g.actualMs - g.hours * 3600000)}h over the ${g.hours}h budget`
      : `${actual}h of ${g.hours}h budget — ${formatHours(g.hours * 3600000 - g.actualMs)}h left`
  }
  if (g.policy === 'minimum') {
    return g.state === 'met'
      ? `${actual}h — minimum of ${g.hours}h met`
      : `${actual}h of ${g.hours}h minimum — ${formatHours(g.hours * 3600000 - g.actualMs)}h to go`
  }
  return g.state === 'met'
    ? `${actual}h — ${g.hours}h target reached`
    : `${actual}h of ${g.hours}h target — ${formatHours(g.hours * 3600000 - g.actualMs)}h to go`
}

function goalBarWidth(g: GoalProgress): number {
  if (g.hours <= 0) return 0
  return Math.min(100, (g.actualMs / (g.hours * 3600000)) * 100)
}

function openHistory(type: string, category: string | null = null) {
  const query: Record<string, string> = { view: 'list', type }
  if (category) query.category = category
  if (periodKind.value === 'day') {
    const d = new Date(range.value.start)
    query.day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  router.push({ path: '/history', query })
}

function prevPeriod() {
  anchor.value = shiftPeriodAnchor(periodKind.value, anchor.value, -1)
}
function nextPeriod() {
  anchor.value = shiftPeriodAnchor(periodKind.value, anchor.value, 1)
}
function goToCurrent() {
  anchor.value = store.now
}
function setKind(kind: PeriodKind) {
  if (periodKind.value !== kind) {
    periodKind.value = kind
    anchor.value = store.now
  }
}

const maxTotalMs = computed(() => Math.max(1, ...totals.value.map((t) => t.totalMs)))
</script>

<template>
  <div class="dashboard">
    <header class="page-head">
      <p class="eyebrow" data-test="period-label">{{ periodLabel }} · {{ periodContext }}</p>
      <h1 class="page-title">Insights</h1>
    </header>

    <div class="period-nav" role="group" aria-label="Select period">
      <div class="seg period-kind" role="group" aria-label="Period length">
        <button
          type="button"
          class="seg-btn"
          :class="{ active: periodKind === 'day' }"
          :aria-pressed="periodKind === 'day'"
          data-test="period-day"
          @click="setKind('day')"
        >Day</button>
        <button
          type="button"
          class="seg-btn"
          :class="{ active: periodKind === 'week' }"
          :aria-pressed="periodKind === 'week'"
          data-test="period-week"
          @click="setKind('week')"
        >Week</button>
      </div>
      <div class="period-shift">
        <button type="button" class="icon-btn" :aria-label="`Previous ${periodKind}`" data-test="period-prev" @click="prevPeriod">
          <ChevronLeft class="nav-icon" />
        </button>
        <button
          v-if="!isCurrent"
          type="button"
          class="current-btn"
          data-test="period-current"
          @click="goToCurrent"
        >Now</button>
        <button type="button" class="icon-btn" :aria-label="`Next ${periodKind}`" data-test="period-next" :disabled="isCurrent" @click="nextPeriod">
          <ChevronRight class="nav-icon" />
        </button>
      </div>
    </div>

    <div class="summary-cards panel stats">
      <div class="summary-card stat">
        <Clock class="card-icon" aria-hidden="true" />
        <div class="card-content">
          <span class="card-label">Tracked</span>
          <span class="card-value stat-num" data-test="tracked-total">{{ formatHours(coverage.trackedMs) }}h</span>
          <span class="card-sub stat-sub">{{ formatHours(coverage.untrackedMs) }}h untracked of {{ formatHours(coverage.elapsedMs) }}h elapsed</span>
        </div>
      </div>
      <div class="summary-card stat">
        <div class="card-content">
          <span class="card-label">vs previous {{ periodKind }}</span>
          <span class="card-value stat-num" data-test="comparison-delta">{{ deltaMs >= 0 ? '+' : '−' }}{{ formatHours(deltaMs) }}h</span>
          <span class="card-sub stat-sub" data-test="comparison-label">
            {{ comparison.complete ? 'full previous period' : 'same elapsed slice of the previous ' + periodKind }}
            — then {{ formatHours(prevTotalMs) }}h
          </span>
        </div>
      </div>
    </div>

    <section v-if="goals.length" class="goals-section panel" aria-label="Goal progress">
      <h3 class="section-title">Goals</h3>
      <div
        v-for="g in goals"
        :key="g.id"
        class="goal-row"
        data-test="goal-row"
      >
        <div class="goal-head">
          <span class="goal-name">{{ activityName(g.id) }}</span>
          <span class="goal-policy">{{ GOAL_POLICY_LABELS[g.policy] }}</span>
        </div>
        <div class="bar-track" role="img" :aria-label="goalLine(g)">
          <div class="bar-fill" :class="{ 'is-over': g.state === 'over', 'is-met': g.state === 'met' }" :style="{ width: goalBarWidth(g) + '%' }" />
        </div>
        <p class="goal-line" :class="{ 'is-over': g.state === 'over' }">{{ goalLine(g) }}</p>
      </div>
    </section>
    <p v-else-if="periodKind === 'week'" class="empty-note" data-test="no-goals">
      No goals configured — totals below are plain records, not a plan. Goals can be set in Settings.
    </p>

    <section class="totals-section panel" aria-label="Activity totals">
      <h3 class="section-title">{{ periodKind === 'day' ? 'Today’s activities' : 'This week’s activities' }}</h3>
      <div v-if="totals.length === 0" class="empty-note" data-test="no-totals">
        Nothing recorded in this period yet.
      </div>
      <div
        v-for="t in totals"
        :key="t.type"
        class="chart-bar"
      >
        <div class="bar-label">
          <button type="button" class="link-btn" :data-test="`total-link-${t.type}`" @click="openHistory(t.type)">
            <span class="bar-dot" :style="{ background: accentOf(t.type) }" aria-hidden="true" />{{ activityName(t.type) }}
          </button>
        </div>
        <div class="bar-track" role="img" :aria-label="`${activityName(t.type)}: ${formatHours(t.totalMs)}h`">
          <div class="bar-fill" :style="{ width: (t.totalMs / maxTotalMs) * 100 + '%', background: accentOf(t.type) }" />
        </div>
        <div class="bar-values">
          <span class="bar-current">{{ formatHours(t.totalMs) }}h</span>
          <span class="bar-allowance" v-if="prevTotals.has(t.type)">
            {{ comparison.complete ? 'prev ' + periodKind : 'prev slice' }}: {{ formatHours(prevTotals.get(t.type) ?? 0) }}h
          </span>
        </div>
      </div>
    </section>

    <section v-if="categories.length" class="totals-section panel" aria-label="Category breakdown">
      <h3 class="section-title">Category breakdown</h3>
      <div v-for="cat in categories" :key="cat.key" class="category-row">
        <button type="button" class="link-btn" :data-test="`cat-link-${cat.type}-${cat.category}`" @click="openHistory(cat.type, cat.category)">
          <span class="bar-dot" :style="{ background: accentOf(cat.type) }" aria-hidden="true" />{{ activityName(cat.type) }} – {{ cat.category.charAt(0).toUpperCase() + cat.category.slice(1) }}
        </button>
        <span class="cat-hours">{{ formatHours(cat.totalMs) }}h</span>
      </div>
    </section>

    <section class="checks-section panel" aria-label="Progress checks for period">
      <h3 class="section-title">Checks in this {{ periodKind }}</h3>
      <p v-if="!checksAvailable" class="empty-note" data-test="checks-unavailable">
        Check history isn't available for this period — recording started
        {{ store.progressHistoryStartedAt === null ? 'when checks were first answered' : new Date(store.progressHistoryStartedAt).toLocaleDateString() }}.
      </p>
      <dl v-else class="progress-counts stats" data-test="check-counts">
        <div><dt>Made progress</dt><dd>{{ checkCounts.progress }}</dd></div>
        <div><dt>Blocked</dt><dd>{{ checkCounts.blocked }}</dd></div>
        <div><dt>Snoozed</dt><dd>{{ checkCounts.snoozed }}</dd></div>
        <div><dt>Skipped</dt><dd>{{ checkCounts.skipped }}</dd></div>
        <div><dt>Longest blocked streak</dt><dd data-test="period-blocked-streak">{{ blockedStreak }}</dd></div>
      </dl>
    </section>

    <ProgressCheckDetails v-if="store.settings.progressCheckEnabled" />
  </div>
</template>

<style scoped>
.dashboard {
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-width: 0;
  max-width: 780px;
  width: 100%;
  margin: 0 auto;
}

.period-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.period-shift {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.nav-icon {
  width: 20px;
  height: 20px;
}

.current-btn {
  min-height: 40px;
  padding: 0 14px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--color-primary);
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 650;
  cursor: pointer;
}

.current-btn:hover {
  background: var(--color-surface-raised);
  border-color: var(--color-border);
}

.summary-cards {
  overflow: hidden;
}

.summary-card {
  flex-direction: row;
  align-items: center;
  gap: 14px;
}

.card-icon {
  width: 26px;
  height: 26px;
  color: var(--color-primary);
  flex-shrink: 0;
}

.card-content {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.card-label {
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.goals-section,
.totals-section,
.checks-section {
  padding: 16px 20px;
}

.section-title {
  margin: 0 0 14px;
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  font-weight: 500;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.goal-row {
  margin-bottom: 14px;
}

.goal-row:last-child {
  margin-bottom: 0;
}

.goal-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.goal-name {
  font-size: 0.875rem;
  font-weight: 650;
  color: var(--color-text);
}

.goal-policy {
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.goal-line {
  margin: 4px 0 0;
  font-size: 0.8125rem;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

.goal-line.is-over {
  color: var(--color-danger-text);
}

.bar-track {
  height: 6px;
  margin-top: 6px;
  background: var(--control-bg);
  border-radius: 3px;
  overflow: hidden;
}

.bar-fill {
  height: 100%;
  border-radius: 3px;
  background: var(--color-primary);
  transition: width 0.3s ease;
}

.bar-fill.is-met {
  background: var(--accent-green, #4ade80);
}

.bar-fill.is-over {
  background: var(--color-danger-text, #f87171);
}

.chart-bar {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 14px;
}

.chart-bar:last-child {
  margin-bottom: 0;
}

.bar-label {
  font-size: 0.875rem;
  color: var(--color-text);
}

.link-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  border: none;
  background: none;
  padding: 4px 0;
  font: inherit;
  color: var(--color-primary);
  cursor: pointer;
  text-align: left;
  min-height: 32px;
}

.bar-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.link-btn:hover {
  text-decoration: underline;
}

.bar-values {
  display: flex;
  justify-content: space-between;
  font-size: 0.75rem;
}

.bar-current {
  color: var(--color-text);
  font-weight: 650;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}

.bar-allowance {
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

.category-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
}

.category-row + .category-row {
  border-top: 1px solid var(--hairline);
}

.cat-hours {
  font-family: var(--font-mono);
  font-size: 0.875rem;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

.empty-note {
  margin: 0;
  font-size: 0.875rem;
  color: var(--color-text-muted);
}

.progress-counts {
  margin: -2px -20px -16px;
}

@media (max-width: 480px) {
  .goals-section,
  .totals-section,
  .checks-section {
    padding: 14px 16px;
  }

  .progress-counts {
    margin: -2px -16px -14px;
  }

  .summary-card {
    flex-basis: 100%;
  }
}
</style>
