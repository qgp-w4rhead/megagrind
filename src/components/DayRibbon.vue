<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { Minus, Plus } from 'lucide-vue-next'
import { useMegagrindStore } from '../stores/megagrind'
import { getTrackerConfig } from '../config/trackers'
import { activityLabel } from '../domain/labels'
import type { TimeRange, TrackerType } from '../types'
import { formatDuration, type RibbonSegment } from '../domain/today'

const props = defineProps<{ segments: RibbonSegment[]; day: TimeRange; now: number }>()
const store = useMegagrindStore()

const HOUR = 3600000
const MINUTE = 60000
const MIN_TICK_LABEL_PX = 56
const MIN_ZOOM = 1
const MAX_ZOOM = 96
const MAX_TICKS = 400

const COARSEST_TICK: { step: number; minor: number } = { step: 4 * HOUR, minor: HOUR }
const TICK_STEPS: ReadonlyArray<{ step: number; minor: number }> = [
  { step: 5 * MINUTE, minor: MINUTE },
  { step: 15 * MINUTE, minor: 5 * MINUTE },
  { step: 30 * MINUTE, minor: 5 * MINUTE },
  { step: HOUR, minor: 15 * MINUTE },
  { step: 2 * HOUR, minor: 30 * MINUTE },
  COARSEST_TICK,
]

const scrollEl = ref<HTMLElement | null>(null)
const nowTagEl = ref<HTMLElement | null>(null)
const viewportWidth = ref(0)
const nowTagWidth = ref(0)
const zoom = ref(MIN_ZOOM)
const panning = ref(false)

const daySpan = computed(() => Math.max(1, props.day.end - props.day.start))
const nowPct = computed(() =>
  Math.min(100, Math.max(0, ((props.now - props.day.start) / daySpan.value) * 100)),
)
const canvasPx = computed(() => Math.max(1, viewportWidth.value * zoom.value))
const nowTagLeft = computed(() => {
  const halfPct = ((nowTagWidth.value / 2) / canvasPx.value) * 100
  return Math.min(100 - halfPct, Math.max(halfPct, nowPct.value))
})

const tickStep = computed(() => {
  for (const candidate of TICK_STEPS) {
    if ((candidate.step / daySpan.value) * canvasPx.value >= MIN_TICK_LABEL_PX) return candidate
  }
  return COARSEST_TICK
})

interface Tick {
  ms: number
  pct: number
  major: boolean
  edge: 'start' | 'end' | null
}

const ticks = computed<Tick[]>(() => {
  const { start, end } = props.day
  const { step, minor } = tickStep.value
  const interval = daySpan.value / minor <= MAX_TICKS ? minor : step
  const out: Tick[] = []
  for (let ms = start; ms <= end; ms += interval) {
    out.push({
      ms,
      pct: ((ms - start) / daySpan.value) * 100,
      major: (ms - start) % step === 0,
      edge: ms === start ? 'start' : ms === end ? 'end' : null,
    })
  }
  return out
})

const zoomLabel = computed(() =>
  `${Number.isInteger(zoom.value) ? zoom.value : zoom.value.toFixed(1)}×`,
)

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value))
}

function zoomAt(anchorFraction: number, next: number) {
  const el = scrollEl.value
  next = clampZoom(next)
  if (!el || next === zoom.value) {
    zoom.value = next
    return
  }
  const vw = el.clientWidth
  const rel = (el.scrollLeft + anchorFraction * vw) / Math.max(1, el.scrollWidth)
  zoom.value = next
  void nextTick(() => {
    el.scrollLeft = rel * el.scrollWidth - anchorFraction * vw
  })
}

function zoomAnchor(): number {
  const el = scrollEl.value
  if (!el) return 0.5
  const nowX = (nowPct.value / 100) * el.scrollWidth
  if (nowX < el.scrollLeft || nowX > el.scrollLeft + el.clientWidth) return 0.5
  return (nowX - el.scrollLeft) / el.clientWidth
}

function zoomIn() {
  zoomAt(zoomAnchor(), zoom.value * 2)
}

function zoomOut() {
  zoomAt(zoomAnchor(), zoom.value / 2)
}

function resetZoom() {
  zoom.value = MIN_ZOOM
}

function onWheel(e: WheelEvent) {
  const el = scrollEl.value
  if (!el) return
  const unit = e.deltaMode === 1 ? 33 : 1
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault()
    const rect = el.getBoundingClientRect()
    const fraction = Math.min(1, Math.max(0, (e.clientX - rect.left) / Math.max(1, rect.width)))
    zoomAt(fraction, zoom.value * Math.exp(-e.deltaY * unit * 0.0022))
  } else if ((e.deltaX !== 0 || e.shiftKey) && el.scrollWidth > el.clientWidth) {
    e.preventDefault()
    el.scrollLeft += (e.deltaY + e.deltaX) * unit
  }
}

let panStartX = 0
let panStartScroll = 0

function onPanStart(e: PointerEvent) {
  const el = scrollEl.value
  if (!el || e.button !== 0 || e.pointerType === 'touch') return
  if (e.target === el && e.offsetY > el.clientHeight) return
  panning.value = true
  panStartX = e.clientX
  panStartScroll = el.scrollLeft
  el.setPointerCapture(e.pointerId)
}

function onPanMove(e: PointerEvent) {
  const el = scrollEl.value
  if (!panning.value || !el) return
  el.scrollLeft = panStartScroll - (e.clientX - panStartX)
}

function onPanEnd(e: PointerEvent) {
  const el = scrollEl.value
  if (!panning.value || !el) return
  panning.value = false
  if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === '+' || e.key === '=') {
    e.preventDefault()
    zoomIn()
  } else if (e.key === '-' || e.key === '_') {
    e.preventDefault()
    zoomOut()
  } else if (e.key === '0') {
    e.preventDefault()
    resetZoom()
  }
}

const cleanups: Array<() => void> = []

onMounted(() => {
  const el = scrollEl.value
  if (!el) return
  el.addEventListener('wheel', onWheel, { passive: false })
  cleanups.push(() => el.removeEventListener('wheel', onWheel))
  const tag = nowTagEl.value
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(() => {
      viewportWidth.value = el.clientWidth
      if (tag) nowTagWidth.value = tag.offsetWidth
    })
    observer.observe(el)
    if (tag) observer.observe(tag)
    cleanups.push(() => observer.disconnect())
  } else {
    const onResize = () => {
      viewportWidth.value = el.clientWidth
    }
    window.addEventListener('resize', onResize)
    cleanups.push(() => window.removeEventListener('resize', onResize))
  }
  viewportWidth.value = el.clientWidth
  if (tag) nowTagWidth.value = tag.offsetWidth
})

onBeforeUnmount(() => {
  cleanups.forEach((cleanup) => cleanup())
})

function labelOf(type: TrackerType): string {
  return activityLabel(type, store.settings.activities)
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
    <div class="ribbon-top">
      <h2 id="day-ribbon-heading" class="section-heading">Today timeline</h2>
      <div class="ribbon-side">
        <span class="ribbon-hint">Shift + scroll to pan · Ctrl + scroll to zoom</span>
        <div class="ribbon-zoom" role="group" aria-label="Timeline zoom controls">
          <button
            type="button"
            class="btn-action ribbon-zoom-btn"
            data-test="ribbon-zoom-out"
            aria-label="Zoom out"
            :disabled="zoom <= MIN_ZOOM"
            @click="zoomOut"
          >
            <Minus :size="16" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="btn-action ribbon-zoom-level"
            data-test="ribbon-zoom-reset"
            aria-label="Reset zoom"
            :disabled="zoom <= MIN_ZOOM"
            @click="resetZoom"
          >
            {{ zoomLabel }}
          </button>
          <button
            type="button"
            class="btn-action ribbon-zoom-btn"
            data-test="ribbon-zoom-in"
            aria-label="Zoom in"
            :disabled="zoom >= MAX_ZOOM"
            @click="zoomIn"
          >
            <Plus :size="16" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>

    <div
      ref="scrollEl"
      class="ribbon-scroll"
      :class="{ 'is-panning': panning }"
      data-test="ribbon-scroll"
      tabindex="0"
      role="region"
      aria-label="Today timeline, scroll horizontally to pan"
      @pointerdown="onPanStart"
      @pointermove="onPanMove"
      @pointerup="onPanEnd"
      @pointercancel="onPanEnd"
      @lostpointercapture="onPanEnd"
      @keydown="onKeydown"
    >
      <div class="ribbon-canvas" :style="{ width: `${zoom * 100}%` }">
        <div class="ribbon-track" aria-hidden="true">
          <span
            v-for="s in segments"
            :key="s.id"
            class="ribbon-segment"
            :class="{ 'is-running': s.isRunning }"
            :style="{ left: `${s.leftPct}%`, width: `${s.widthPct}%`, background: accentOf(s.type) }"
          />
          <span class="ribbon-now-line" :style="{ left: `${nowPct}%` }" />
        </div>
        <div class="ribbon-ruler" aria-hidden="true">
          <span
            v-for="t in ticks"
            :key="t.ms"
            class="ribbon-tick"
            :class="{ 'is-major': t.major }"
            :style="{ left: `${t.pct}%` }"
          >
            <span
              v-if="t.major"
              class="ribbon-tick-label"
              :class="{ 'is-start': t.edge === 'start', 'is-end': t.edge === 'end' }"
              >{{ clock(t.ms) }}</span
            >
          </span>
          <span class="ribbon-now-stem" :style="{ left: `${nowPct}%` }" />
          <span
            ref="nowTagEl"
            class="ribbon-now-tag"
            data-test="ribbon-now"
            :style="{ left: `${nowTagLeft}%` }"
            >{{ clock(now) }}</span
          >
        </div>
      </div>
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

.ribbon-top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 6px 12px;
}

.section-heading {
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  font-weight: 500;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.ribbon-side {
  display: flex;
  align-items: center;
  gap: 10px;
}

.ribbon-hint {
  font-size: 0.75rem;
  color: var(--color-text-muted);
  white-space: nowrap;
}

.ribbon-zoom {
  display: flex;
  gap: 4px;
}

.ribbon-zoom-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 10px;
}

.ribbon-zoom-level {
  padding: 0 12px;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 0.8125rem;
}

.ribbon-zoom-btn:disabled,
.ribbon-zoom-level:disabled {
  opacity: 0.45;
  cursor: default;
}

.ribbon-scroll {
  overflow-x: auto;
  overflow-y: hidden;
  cursor: grab;
  user-select: none;
  scrollbar-width: thin;
  scrollbar-color: var(--color-border) transparent;
}

.ribbon-scroll.is-panning {
  cursor: grabbing;
}

.ribbon-scroll::-webkit-scrollbar {
  height: 8px;
}

.ribbon-scroll::-webkit-scrollbar-thumb {
  background: var(--color-border);
  border-radius: 4px;
}

.ribbon-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.ribbon-canvas {
  min-width: 100%;
}

.ribbon-track {
  position: relative;
  height: 30px;
  border-radius: 8px;
  background: var(--control-bg);
  border: 1px solid var(--hairline);
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

.ribbon-now-line {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  margin-left: -1px;
  background: var(--color-text);
  box-shadow: 0 0 6px color-mix(in oklch, var(--color-text), transparent 45%);
}

.ribbon-ruler {
  position: relative;
  height: 30px;
  margin-top: 4px;
}

.ribbon-tick {
  position: absolute;
  top: 0;
  width: 1px;
  height: 5px;
  background: var(--color-border-subtle);
}

.ribbon-tick.is-major {
  height: 9px;
  background: var(--color-border);
}

.ribbon-tick-label {
  position: absolute;
  top: 11px;
  left: 0;
  transform: translateX(-50%);
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 0.6875rem;
  color: var(--color-text-muted);
  white-space: nowrap;
}

.ribbon-tick-label.is-start {
  transform: none;
}

.ribbon-tick-label.is-end {
  transform: translateX(-100%);
}

.ribbon-now-stem {
  position: absolute;
  top: 0;
  width: 1px;
  height: 8px;
  background: var(--color-text);
}

.ribbon-now-tag {
  position: absolute;
  top: 8px;
  transform: translateX(-50%);
  padding: 2px 6px;
  border-radius: 5px;
  background: var(--color-text);
  color: var(--color-page);
  border: none;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 0.6875rem;
  font-weight: 700;
  white-space: nowrap;
}

.ribbon-legend {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0;
  font-size: 0.9375rem;
}

.ribbon-legend-item {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  gap: 10px;
  align-items: center;
  padding: 5px 8px;
  border-radius: 8px;
}

.ribbon-legend-item:hover {
  background: var(--color-surface-raised);
}

.ribbon-swatch {
  width: 10px;
  height: 10px;
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
  .ribbon-hint {
    display: none;
  }

  .ribbon-legend-item {
    grid-template-columns: auto minmax(0, 1fr) auto;
  }

  .ribbon-legend-time {
    grid-column: 2 / 3;
  }
}
</style>
