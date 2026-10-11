import type { EntrySlice, TimeEntry, TimeRange } from '../types'

export function isTimeAdjustment(entry: TimeEntry): boolean {
  return entry.end !== null && (entry.end < entry.start || (entry.isCorrection === true && Boolean(entry.balancedWith)))
}

export function sliceEntry(entry: TimeEntry, range: TimeRange, now: number): EntrySlice | null {
  if (!Number.isFinite(range.start) || !Number.isFinite(range.end) || range.end <= range.start || !Number.isFinite(now) || !Number.isFinite(entry.start) || (entry.end !== null && !Number.isFinite(entry.end))) return null
  if (isTimeAdjustment(entry)) {
    if (entry.start < range.start || entry.start >= range.end || entry.start > now) return null
    return { entry, start: entry.start, end: entry.start, duration: entry.end! - entry.start, isAdjustment: true, isRunning: false }
  }
  const start = Math.max(entry.start, range.start)
  const end = Math.min(entry.end ?? now, range.end, now)
  if (end <= start) return null
  return { entry, start, end, duration: end - start, isAdjustment: false, isRunning: entry.end === null }
}

export function sliceEntries(entries: readonly TimeEntry[], range: TimeRange, now: number): EntrySlice[] {
  return entries.flatMap(entry => {
    const slice = sliceEntry(entry, range, now)
    return slice ? [slice] : []
  }).sort((a, b) => a.start - b.start || a.entry.id.localeCompare(b.entry.id))
}

export function totalDuration(entries: readonly TimeEntry[], range: TimeRange, now: number, type?: string): number {
  return sliceEntries(type === undefined ? entries : entries.filter(entry => entry.type === type), range, now).reduce((sum, slice) => sum + slice.duration, 0)
}

export function coveredDuration(slices: readonly EntrySlice[]): number {
  const intervals = slices.filter(slice => !slice.isAdjustment).slice().sort((a, b) => a.start - b.start)
  let total = 0
  let coveredUntil = -Infinity
  for (const interval of intervals) {
    total += Math.max(0, interval.end - Math.max(interval.start, coveredUntil))
    coveredUntil = Math.max(coveredUntil, interval.end)
  }
  return total
}

export function formatCountdown(ms: number): string {
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function dayRange(at: number): TimeRange {
  const start = new Date(at)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { start: start.getTime(), end: end.getTime() }
}

export function weekRange(at: number, rolloverDay: number, rolloverHour: number): TimeRange {
  const date = new Date(at)
  const start = new Date(date)
  start.setDate(date.getDate() - (date.getDay() - rolloverDay + 7) % 7)
  start.setHours(rolloverHour, 0, 0, 0)
  if (start.getTime() > at) start.setDate(start.getDate() - 7)
  const end = new Date(start)
  end.setDate(end.getDate() + 7)
  end.setHours(rolloverHour, 0, 0, 0)
  return { start: start.getTime(), end: end.getTime() }
}
