import type { EntrySlice, TimeEntry, TimeRange, TrackerType } from '../types'
import { coveredDuration, dayRange, sliceEntries, totalDuration } from './time'

export interface RibbonSegment {
  id: string
  type: TrackerType
  start: number
  end: number
  duration: number
  leftPct: number
  widthPct: number
  isRunning: boolean
}

export interface TodayPresentation {
  day: TimeRange
  elapsed: number
  covered: number
  untracked: number
  net: number
  normalSum: number
  overlap: boolean
  segments: RibbonSegment[]
  adjustments: EntrySlice[]
}

export function todayPresentation(entries: readonly TimeEntry[], now: number): TodayPresentation {
  const day = dayRange(now)
  const slices = sliceEntries(entries, day, now)
  const elapsed = Math.max(0, Math.min(now, day.end) - day.start)
  const covered = coveredDuration(slices)
  const untracked = Math.max(0, elapsed - covered)
  const net = totalDuration(entries, day, now)
  const normal = slices.filter((s) => !s.isAdjustment)
  const normalSum = normal.reduce((sum, s) => sum + s.duration, 0)
  const span = day.end - day.start
  const segments = normal.map((s) => ({
    id: s.entry.id,
    type: s.entry.type,
    start: s.start,
    end: s.end,
    duration: s.duration,
    leftPct: ((s.start - day.start) / span) * 100,
    widthPct: ((s.end - s.start) / span) * 100,
    isRunning: s.isRunning,
  }))
  return {
    day,
    elapsed,
    covered,
    untracked,
    net,
    normalSum,
    overlap: normalSum > covered,
    segments,
    adjustments: slices.filter((s) => s.isAdjustment),
  }
}

export function formatDuration(ms: number): string {
  const sign = ms < 0 ? '-' : ''
  const minutes = Math.round(Math.abs(ms) / 60000)
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${sign}${h}h ${String(m).padStart(2, '0')}m` : `${sign}${m}m`
}

export function recentFinishedEntries(entries: readonly TimeEntry[], limit = 5): TimeEntry[] {
  return entries
    .filter((e) => e.end !== null)
    .slice()
    .sort((a, b) => b.start - a.start)
    .slice(0, limit)
}
