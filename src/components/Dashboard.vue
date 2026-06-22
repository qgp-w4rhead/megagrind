<script setup lang="ts">
import { computed } from 'vue'
import { useMegagrindStore } from '../stores/megagrind'
import { TRACKER_LABELS } from '../types'
import { BarChart3, Clock, TrendingUp, AlertCircle } from 'lucide-vue-next'

const store = useMegagrindStore()

const weeklyStats = computed(() => {
  const stats: Record<string, { total: number; allowance: number; label: string }> = {}
  
  Object.keys(store.settings.weeklyAllocations).forEach((key) => {
    if (key === 'idle') return
    const total = store.getTotalTimeForType(key as any)
    const allowance = (store.settings.weeklyAllocations[key] ?? 0) * 60 * 60 * 1000
    stats[key] = {
      total,
      allowance,
      label: TRACKER_LABELS[key] || key.charAt(0).toUpperCase() + key.slice(1),
    }
  })

  return stats
})

const workHours = computed(() => {
  const total = store.getTotalTimeForType('work')
  return (total / (60 * 60 * 1000)).toFixed(1)
})

const totalAllocated = computed(() => {
  return Object.values(store.settings.weeklyAllocations).reduce((a, b) => a + b, 0)
})

const remainingWorkHours = computed(() => {
  const workAllocation = 168 - totalAllocated.value
  const total = store.getTotalTimeForType('work')
  const remaining = workAllocation - total / (60 * 60 * 1000)
  return remaining.toFixed(1)
})

const progressPercentage = computed(() => {
  const workAllocation = 168 - totalAllocated.value
  if (workAllocation <= 0) return '0.0'
  const total = store.getTotalTimeForType('work')
  const percentage = (total / (60 * 60 * 1000)) / workAllocation * 100
  return Math.min(100, Math.max(0, percentage)).toFixed(1)
})

const redCount = computed(() => store.progressCheck.redCount)

const timeCorrectionBalance = computed(() => {
  const threeMinutesAgo = Date.now() - 3 * 60 * 1000
  const recentCorrections = store.entries.filter(e =>
    e.isCorrection &&
    e.end !== null &&
    e.start >= threeMinutesAgo
  )
  
  // Group balanced corrections together
  const groups: Array<{ corrections: typeof recentCorrections }> = []
  const processedIds = new Set<string>()
  
  for (const correction of recentCorrections) {
    if (processedIds.has(correction.id)) continue
    
    if (correction.balancedWith) {
      const paired = recentCorrections.find(e => e.id === correction.balancedWith)
      if (paired) {
        groups.push({ corrections: [correction, paired] })
        processedIds.add(correction.id)
        processedIds.add(paired.id)
        continue
      }
    }
    
    groups.push({ corrections: [correction] })
    processedIds.add(correction.id)
  }
  
  return groups
})

function formatHours(ms: number): string {
  return (ms / (60 * 60 * 1000)).toFixed(1)
}

function getBarWidth(total: number, allowance: number): number {
  if (allowance === 0) return total > 0 ? 100 : 0
  const percentage = (total / allowance) * 100
  return Math.min(100, Math.max(0, percentage))
}

function getBarColor(total: number, allowance: number): string {
  const diff = total - allowance
  if (diff > 0) return '#f87171'
  if (diff < -3600000) return '#fbbf24'
  return '#4ade80'
}
</script>

<template>
  <div class="dashboard">
    <div class="dashboard-header">
      <h2>Weekly Overview</h2>
      <BarChart3 class="header-icon" />
    </div>

    <div class="summary-cards">
      <div class="summary-card work-card">
        <Clock class="card-icon" />
        <div class="card-content">
          <span class="card-label">Work This Week</span>
          <span class="card-value">{{ workHours }}h</span>
          <span class="card-sub">of {{ remainingWorkHours }}h remaining</span>
        </div>
      </div>

      <div class="summary-card progress-card">
        <TrendingUp class="card-icon" />
        <div class="card-content">
          <span class="card-label">Weekly Progress</span>
          <span class="card-value">{{ progressPercentage }}%</span>
          <span class="card-sub">of work goal</span>
        </div>
      </div>

      <div class="summary-card reds-card">
        <AlertCircle class="card-icon" />
        <div class="card-content">
          <span class="card-label">Red Checks Today</span>
          <span class="card-value">{{ redCount }}</span>
          <span class="card-sub">{{ redCount >= 3 ? 'Take a walk!' : 'Keep going' }}</span>
        </div>
      </div>
    </div>

    <div class="allocation-chart">
      <h3>Time Allocation</h3>
      <div class="chart-bars">
        <div
          v-for="(stat, key) in weeklyStats"
          :key="key"
          class="chart-bar"
        >
          <div class="bar-label">{{ stat.label }}</div>
          <div class="bar-track">
            <div
              class="bar-fill"
              :style="{
                width: getBarWidth(stat.total, stat.allowance) + '%',
                backgroundColor: getBarColor(stat.total, stat.allowance)
              }"
            />
          </div>
          <div class="bar-values">
            <span class="bar-current">{{ formatHours(stat.total) }}h</span>
            <span class="bar-allowance">/ {{ formatHours(stat.allowance) }}h</span>
          </div>
        </div>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-box">
        <h4>Total Allocated</h4>
        <span class="stat-number">{{ totalAllocated.toFixed(1) }}h</span>
        <span class="stat-desc">Non-work activities</span>
      </div>
      <div class="stat-box">
        <h4>Available for Work</h4>
        <span class="stat-number">{{ (168 - totalAllocated).toFixed(1) }}h</span>
        <span class="stat-desc">From 168h total</span>
      </div>
      <div class="stat-box">
        <h4>Bill Gates Target</h4>
        <span class="stat-number">100h</span>
        <span class="stat-desc">Weekly goal</span>
      </div>
    </div>

    <div v-if="timeCorrectionBalance.length > 0" class="corrections-section">
      <h3>Time Correction Balance</h3>
      <div class="corrections-list">
        <div v-for="(group, groupIndex) in timeCorrectionBalance" :key="`group-${groupIndex}`" class="correction-group">
          <div v-for="correction in group.corrections" :key="correction.id" class="correction-item">
            <span class="correction-description">
              {{ correction.end && correction.end < correction.start ? '-' : '+' }}{{ Math.abs((correction.end || 0) - correction.start) / 60000 }}min
              {{ correction.description ? ` - ${correction.description}` : '' }}
            </span>
            <span class="correction-time">{{ new Date(correction.start).toLocaleTimeString() }}</span>
          </div>
          <div v-if="group.corrections.length > 1" class="balance-indicator">↔ Balanced</div>
        </div>
      </div>
    </div>
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
  margin-bottom: 1.5rem;
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

.summary-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1rem;
  margin-bottom: 2rem;
}

.summary-card {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem;
  background-color: var(--bg-tertiary);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='49' viewBox='0 0 28 49'%3E%3Cg fill-rule='evenodd'%3E%3Cg fill='oklch(0.6 0.18 300)' fill-opacity='0.15'%3E%3Cpath d='M13.99 9.25l13 7.5v15l-13 7.5L1 31.75v-15l12.99-7.5zM3 17.9v12.7l10.99 6.34 11-6.35V17.9l-11-6.34L3 17.9zM0 15l12.98-7.5V0h-2v6.35L0 12.69v2.3zm0 18.5L12.98 41v8h-2v-6.85L0 35.81v-2.3zM15 0v7.5L27.99 15H28v-2.31h-.01L17 6.35V0h-2zm0 49v-8l12.99-7.5H28v2.31h-.01L17 42.15V49h-2z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E");
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

.allocation-chart {
  margin-bottom: 2rem;
}

.allocation-chart h3 {
  margin: 0 0 1rem 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--accent-purple);
}

@media (max-width: 768px) {
  .dashboard {
    padding: 1rem;
  }

  .dashboard-header h2 {
    font-size: 1.125rem;
  }

  .summary-cards {
    grid-template-columns: 1fr !important;
  }

  .allocation-chart h3 {
    font-size: 0.875rem;
  }

  .bar-label {
    font-size: 0.8125rem;
  }

  .bar-current,
  .bar-allowance {
    font-size: 0.6875rem;
  }
}

@media (min-width: 769px) {
  .summary-cards {
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  }
}

@media (max-width: 480px) {
  .dashboard {
    padding: 0.875rem;
  }

  .dashboard-header {
    margin-bottom: 1rem;
  }

  .dashboard-header h2 {
    font-size: 1rem;
  }

  .header-icon {
    width: 20px;
    height: 20px;
  }
}

.chart-bars {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.chart-bar {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.bar-label {
  font-size: 0.875rem;
  color: var(--text-primary);
}

.bar-track {
  height: 8px;
  background: var(--bg-tertiary);
  border-radius: 4px;
  overflow: hidden;
}

.bar-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.3s ease, background-color 0.3s ease;
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

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 1rem;
}

.stat-box {
  padding: 1rem;
  background-color: var(--bg-tertiary);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='49' viewBox='0 0 28 49'%3E%3Cg fill-rule='evenodd'%3E%3Cg fill='oklch(0.6 0.18 300)' fill-opacity='0.15'%3E%3Cpath d='M13.99 9.25l13 7.5v15l-13 7.5L1 31.75v-15l12.99-7.5zM3 17.9v12.7l10.99 6.34 11-6.35V17.9l-11-6.34L3 17.9zM0 15l12.98-7.5V0h-2v6.35L0 12.69v2.3zm0 18.5L12.98 41v8h-2v-6.85L0 35.81v-2.3zM15 0v7.5L27.99 15H28v-2.31h-.01L17 6.35V0h-2zm0 49v-8l12.99-7.5H28v2.31h-.01L17 42.15V49h-2z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E");
  border-radius: 8px;
  text-align: center;
}

.stat-box h4 {
  margin: 0 0 0.5rem 0;
  font-size: 0.75rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.stat-number {
  display: block;
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--accent-purple);
  font-variant-numeric: tabular-nums;
  margin-bottom: 0.25rem;
}

.stat-desc {
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.corrections-section {
  margin-top: 2rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--border-color);
}

.corrections-section h3 {
  margin: 0 0 1rem 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--accent-purple);
}

.corrections-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.correction-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem;
  background: var(--bg-tertiary);
  border-radius: 8px;
  border: 1px solid var(--border-color);
}

.correction-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem 0;
}

.balance-indicator {
  text-align: center;
  font-size: 0.75rem;
  color: var(--accent-green);
  font-weight: 600;
  padding-top: 0.25rem;
  border-top: 1px dashed var(--border-color);
}

.correction-description {
  font-size: 0.875rem;
  color: var(--text-primary);
  font-weight: 500;
}

.correction-time {
  font-size: 0.75rem;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
</style>
