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
import { BarChart3, ChevronLeft, ChevronRight, Clock } from 'lucide-vue-next'

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
    <div class="dashboard-header">
      <h2>Insights</h2>
      <BarChart3 class="header-icon" />
    </div>

    <div class="period-nav" role="group" aria-label="Select period">
      <div class="period-kind" role="group" aria-label="Period length">
        <button
          type="button"
          class="kind-btn"
          :class="{ active: periodKind === 'day' }"
          :aria-pressed="periodKind === 'day'"
          data-test="period-day"
          @click="setKind('day')"
        >Day</button>
        <button
          type="button"
          class="kind-btn"
          :class="{ active: periodKind === 'week' }"
          :aria-pressed="periodKind === 'week'"
          data-test="period-week"
          @click="setKind('week')"
        >Week</button>
      </div>
      <div class="period-shift">
        <button type="button" class="nav-btn" :aria-label="`Previous ${periodKind}`" data-test="period-prev" @click="prevPeriod">
          <ChevronLeft class="nav-icon" />
        </button>
        <button
          v-if="!isCurrent"
          type="button"
          class="current-btn"
          data-test="period-current"
          @click="goToCurrent"
        >Now</button>
        <button type="button" class="nav-btn" :aria-label="`Next ${periodKind}`" data-test="period-next" :disabled="isCurrent" @click="nextPeriod">
          <ChevronRight class="nav-icon" />
        </button>
      </div>
    </div>
    <p class="period-label" data-test="period-label">{{ periodLabel }} <span class="period-context">({{ periodContext }})</span></p>

    <div class="summary-cards">
      <div class="summary-card">
        <Clock class="card-icon" />
        <div class="card-content">
          <span class="card-label">Tracked</span>
          <span class="card-value" data-test="tracked-total">{{ formatHours(coverage.trackedMs) }}h</span>
          <span class="card-sub">{{ formatHours(coverage.untrackedMs) }}h untracked of {{ formatHours(coverage.elapsedMs) }}h elapsed</span>
        </div>
      </div>
      <div class="summary-card">
        <div class="card-content">
          <span class="card-label">vs previous {{ periodKind }}</span>
          <span class="card-value" data-test="comparison-delta">{{ deltaMs >= 0 ? '+' : '−' }}{{ formatHours(deltaMs) }}h</span>
          <span class="card-sub" data-test="comparison-label">
            {{ comparison.complete ? 'full previous period' : 'same elapsed slice of the previous ' + periodKind }}
            — then {{ formatHours(prevTotalMs) }}h
          </span>
        </div>
      </div>
    </div>

    <section v-if="goals.length" class="goals-section" aria-label="Goal progress">
      <h3>Goals</h3>
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

    <section class="totals-section" aria-label="Activity totals">
      <h3>{{ periodKind === 'day' ? 'Today’s activities' : 'This week’s activities' }}</h3>
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
            {{ activityName(t.type) }}
          </button>
        </div>
        <div class="bar-track" role="img" :aria-label="`${activityName(t.type)}: ${formatHours(t.totalMs)}h`">
          <div class="bar-fill" :style="{ width: (t.totalMs / maxTotalMs) * 100 + '%' }" />
        </div>
        <div class="bar-values">
          <span class="bar-current">{{ formatHours(t.totalMs) }}h</span>
          <span class="bar-allowance" v-if="prevTotals.has(t.type)">
            {{ comparison.complete ? 'prev ' + periodKind : 'prev slice' }}: {{ formatHours(prevTotals.get(t.type) ?? 0) }}h
          </span>
        </div>
      </div>
    </section>

    <section v-if="categories.length" class="totals-section" aria-label="Category breakdown">
      <h3>Category breakdown</h3>
      <div v-for="cat in categories" :key="cat.key" class="category-row">
        <button type="button" class="link-btn" :data-test="`cat-link-${cat.type}-${cat.category}`" @click="openHistory(cat.type, cat.category)">
          {{ activityName(cat.type) }} – {{ cat.category.charAt(0).toUpperCase() + cat.category.slice(1) }}
        </button>
        <span class="cat-hours">{{ formatHours(cat.totalMs) }}h</span>
      </div>
    </section>

    <section class="checks-section" aria-label="Progress checks for period">
      <h3>Checks in this {{ periodKind }}</h3>
      <p v-if="!checksAvailable" class="empty-note" data-test="checks-unavailable">
        Check history isn't available for this period — recording started
        {{ store.progressHistoryStartedAt === null ? 'when checks were first answered' : new Date(store.progressHistoryStartedAt).toLocaleDateString() }}.
      </p>
      <dl v-else class="progress-counts" data-test="check-counts">
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
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 1.5rem;
}

.dashboard-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
}

.dashboard-header h2 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-primary);
}

.header-icon {
  width: 24px;
  height: 24px;
  color: var(--accent-purple);
}

.period-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.period-kind {
  display: inline-flex;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
}

.kind-btn {
  min-height: 44px;
  padding: 0 16px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 0.875rem;
  cursor: pointer;
}

.kind-btn.active {
  background: var(--accent-purple);
  color: var(--bg-primary);
  font-weight: 600;
}

.period-shift {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.nav-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  min-height: 44px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.nav-btn:hover:not(:disabled) {
  color: var(--text-primary);
}

.nav-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.nav-icon {
  width: 20px;
  height: 20px;
}

.current-btn {
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: 0.8125rem;
  cursor: pointer;
}

.period-label {
  margin: 0.5rem 0 1.25rem;
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--text-primary);
}

.period-context {
  font-weight: 400;
  color: var(--text-muted);
}

.summary-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.summary-card {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem;
  background-color: var(--bg-tertiary);
  border-radius: 8px;
}

.card-icon {
  width: 32px;
  height: 32px;
  color: var(--accent-purple);
}

.card-content {
  display: flex;
  flex-direction: column;
}

.card-label {
  font-size: 0.75rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.card-value {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.card-sub {
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.goals-section,
.totals-section,
.checks-section {
  margin-bottom: 1.5rem;
}

.goals-section h3,
.totals-section h3,
.checks-section h3 {
  margin: 0 0 0.75rem;
  font-size: 1rem;
  font-weight: 600;
  color: var(--accent-purple);
}

.goal-row {
  margin-bottom: 0.875rem;
}

.goal-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.goal-name {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
}

.goal-policy {
  font-size: 0.75rem;
  color: var(--text-muted);
}

.goal-line {
  margin: 0.125rem 0 0;
  font-size: 0.8125rem;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.goal-line.is-over {
  color: var(--color-danger-text);
}

.bar-track {
  height: 8px;
  margin-top: 4px;
  background: var(--bg-tertiary);
  border-radius: 4px;
  overflow: hidden;
}

.bar-fill {
  height: 100%;
  border-radius: 4px;
  background: var(--accent-purple);
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
  gap: 0.25rem;
  margin-bottom: 0.75rem;
}

.bar-label {
  font-size: 0.875rem;
  color: var(--text-primary);
}

.link-btn {
  border: none;
  background: none;
  padding: 4px 0;
  font: inherit;
  color: var(--accent-purple);
  cursor: pointer;
  text-align: left;
  min-height: 32px;
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
  color: var(--text-primary);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.bar-allowance {
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.category-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 4px 0;
}

.cat-hours {
  font-size: 0.875rem;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.empty-note {
  margin: 0;
  font-size: 0.875rem;
  color: var(--text-muted);
}

.progress-counts {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 24px;
  margin: 0;
}

.progress-counts dt {
  color: var(--text-muted);
  font-size: 0.875rem;
}

.progress-counts dd {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 1.25rem;
  font-variant-numeric: tabular-nums;
}

@media (max-width: 480px) {
  .dashboard {
    padding: 0.875rem;
  }

  .dashboard-header h2 {
    font-size: 1rem;
  }

  .summary-cards {
    grid-template-columns: 1fr;
  }
}
</style>
