<script setup lang="ts">
import { getTrackerConfig } from '../config/trackers'
import { activityLabel } from '../domain/labels'
import type { TrackerType } from '../types'
import { formatDuration, type RibbonSegment } from '../domain/today'

defineProps<{ segments: RibbonSegment[] }>()

function labelOf(type: TrackerType): string {
  return activityLabel(type)
}

function accentOf(type: TrackerType): string {
  return getTrackerConfig(type).accent
}

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <section class="day-ribbon" aria-labelledby="day-ribbon-heading">
    <h2 id="day-ribbon-heading" class="section-heading">Today timeline</h2>
    <div class="ribbon-track" aria-hidden="true">
      <span
        v-for="s in segments"
        :key="s.id"
        class="ribbon-segment"
        :class="{ 'is-running': s.isRunning }"
        :style="{ left: `${s.leftPct}%`, width: `${s.widthPct}%`, background: accentOf(s.type) }"
      />
    </div>
    <ol class="ribbon-legend" data-test="ribbon-legend">
      <li v-for="s in segments" :key="s.id" class="ribbon-legend-item">
        <span class="ribbon-swatch" :style="{ background: accentOf(s.type) }" aria-hidden="true" />
        <span class="ribbon-legend-label">{{ labelOf(s.type) }}</span>
        <span class="ribbon-legend-time">{{ clock(s.start) }} to {{ s.isRunning ? 'now' : clock(s.end) }}</span>
        <span class="ribbon-legend-duration">{{ formatDuration(s.duration) }}</span>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.day-ribbon {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.section-heading {
  font-size: 0.9375rem;
  font-weight: 650;
  color: var(--color-text-muted);
}

.ribbon-track {
  position: relative;
  height: 28px;
  border-radius: 6px;
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border-subtle);
  overflow: hidden;
}

.ribbon-segment {
  position: absolute;
  top: 0;
  bottom: 0;
  opacity: 0.85;
}

.ribbon-segment.is-running {
  opacity: 1;
  box-shadow: inset 0 -3px 0 var(--color-text);
}

.ribbon-legend {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0;
  font-size: 0.9375rem;
}

.ribbon-legend-item {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  gap: 8px;
  align-items: center;
}

.ribbon-swatch {
  width: 12px;
  height: 12px;
  border-radius: 3px;
}

.ribbon-legend-label {
  overflow-wrap: anywhere;
  font-weight: 600;
}

.ribbon-legend-time,
.ribbon-legend-duration {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  color: var(--color-text-muted);
}

@media (max-width: 480px) {
  .ribbon-legend-item {
    grid-template-columns: auto minmax(0, 1fr) auto;
  }

  .ribbon-legend-time {
    grid-column: 2 / 3;
  }
}
</style>
