import type { EntrySlice, Goal, TimeEntry, TimeRange } from '../types'
import { coveredDuration, dayRange, sliceEntries, weekRange } from './time'
import type { GoalPolicy } from './goals'
import { isGoalActive } from './goals'

export type PeriodKind = 'day' | 'week'

export function periodRange(kind: PeriodKind, anchor: number, rolloverDay: number, rolloverHour: number): TimeRange {
  return kind === 'day' ? dayRange(anchor) : weekRange(anchor, rolloverDay, rolloverHour)
}

// Move the selected period by whole days/weeks. The anchor is nudged into the
// middle of the target period so DST-shortened/lengthened days can't skip one.
export function shiftPeriodAnchor(kind: PeriodKind, anchor: number, dir: -1 | 1): number {
  const d = new Date(anchor)
  d.setDate(d.getDate() + dir * (kind === 'day' ? 1 : 7))
  return d.getTime()
}

export function isCurrentPeriod(range: TimeRange, now: number): boolean {
  return now >= range.start && now < range.end
}

// The portion of the selected period that has actually elapsed. Past periods
// end at range.end; the current one ends at now.
export function effectiveEnd(range: TimeRange, now: number): number {
  return Math.min(range.end, now)
}

export interface TypeTotal {
  type: string
  totalMs: number
  slices: number
}

// Per-type totals for the selected range. Adjustment slices contribute their
// signed duration so corrections stay honest.
export function typeTotals(slices: readonly EntrySlice[]): TypeTotal[] {
  const byType = new Map<string, TypeTotal>()
  for (const s of slices) {
    const row = byType.get(s.entry.type) ?? { type: s.entry.type, totalMs: 0, slices: 0 }
    row.totalMs += s.duration
    row.slices += 1
    byType.set(s.entry.type, row)
  }
  return [...byType.values()].sort((a, b) => b.totalMs - a.totalMs || a.type.localeCompare(b.type))
}

export interface CategoryTotal {
  key: string
  type: string
  category: string
  totalMs: number
}

// Category breakdown (work/chores sub-types). Uncategorized entries are
// excluded — the type total row already covers them.
export function categoryTotals(slices: readonly EntrySlice[]): CategoryTotal[] {
  const byCat = new Map<string, CategoryTotal>()
  for (const s of slices) {
    if (!s.entry.category) continue
    const key = `${s.entry.type}:${s.entry.category}`
    const row = byCat.get(key) ?? { key, type: s.entry.type, category: s.entry.category, totalMs: 0 }
    row.totalMs += s.duration
    byCat.set(key, row)
  }
  return [...byCat.values()].sort((a, b) => b.totalMs - a.totalMs || a.key.localeCompare(b.key))
}

export interface Coverage {
  elapsedMs: number
  trackedMs: number
  untrackedMs: number
  adjustmentMs: number
}

// Tracked vs untracked for the elapsed part of the period only — a current
// week/day never counts its future hours as untracked.
export function coverageOf(slices: readonly EntrySlice[], range: TimeRange, now: number): Coverage {
  const end = effectiveEnd(range, now)
  const elapsedMs = Math.max(0, end - range.start)
  const trackedMs = coveredDuration(slices.filter((s) => !s.isAdjustment))
  const adjustmentMs = slices.filter((s) => s.isAdjustment).reduce((sum, s) => sum + s.duration, 0)
  return { elapsedMs, trackedMs, untrackedMs: Math.max(0, elapsedMs - trackedMs), adjustmentMs }
}

export type GoalState = 'met' | 'under' | 'over'

export interface GoalProgress {
  id: string
  policy: GoalPolicy
  hours: number
  actualMs: number
  state: GoalState
}

// Policy-aware progress for the elapsed period. 'met' means the target was
// reached, the minimum satisfied, or the budget still has room — for a budget,
// 'over' means the budget was exceeded (nonjudgmental fact, not failure).
export function goalProgressForPeriod(
  goals: Record<string, Goal>,
  totals: readonly TypeTotal[],
): GoalProgress[] {
  const totalsByType = new Map(totals.map((t) => [t.type, t.totalMs]))
  const rows: GoalProgress[] = []
  for (const [id, goal] of Object.entries(goals)) {
    if (!isGoalActive(goal)) continue
    const actualMs = totalsByType.get(id) ?? 0
    const targetMs = goal.hours * 3600000
    const state: GoalState =
      goal.policy === 'budget'
        ? actualMs > targetMs
          ? 'over'
          : 'met'
        : actualMs >= targetMs
          ? 'met'
          : 'under'
    rows.push({ id, policy: goal.policy, hours: goal.hours, actualMs, state })
  }
  return rows.sort((a, b) => a.id.localeCompare(b.id))
}

export interface Comparison {
  previousRange: TimeRange
  // For an incomplete current period this is clipped to the same elapsed
  // slice of the previous period, so the comparison is apples-to-apples.
  compareRange: TimeRange
  complete: boolean
}

export function comparisonFor(
  kind: PeriodKind,
  range: TimeRange,
  now: number,
  rolloverDay: number,
  rolloverHour: number,
): Comparison {
  const prevAnchor = shiftPeriodAnchor(kind, range.start + 3600000, -1)
  const previousRange = periodRange(kind, prevAnchor, rolloverDay, rolloverHour)
  const elapsed = Math.max(0, effectiveEnd(range, now) - range.start)
  const complete = effectiveEnd(range, now) >= range.end
  const compareRange = complete
    ? previousRange
    : { start: previousRange.start, end: Math.min(previousRange.end, previousRange.start + elapsed) }
  return { previousRange, compareRange, complete }
}

export interface DayBucket {
  dayStart: number
  types: string[]
  totalMs: number
}

// One pass over the entries instead of one sliceEntries call per visible day:
// each entry is clipped to the days it overlaps, so a cross-midnight session
// lands in both days' buckets without duplicating the stored entry.
export function dayBuckets(entries: readonly TimeEntry[], range: TimeRange, now: number): Map<number, DayBucket> {
  const buckets = new Map<number, DayBucket>()
  for (const entry of entries) {
    const end = entry.end ?? now
    if (!Number.isFinite(entry.start) || !Number.isFinite(end) || end <= range.start || entry.start >= range.end) continue
    let day = dayRange(Math.max(entry.start, range.start)).start
    while (day < range.end && day < end) {
      const dr = dayRange(day)
      const slices = sliceEntries([entry], dr, now)
      const bucket = buckets.get(dr.start) ?? { dayStart: dr.start, types: [], totalMs: 0 }
      for (const s of slices) {
        bucket.totalMs += s.duration
        if (!bucket.types.includes(s.entry.type)) bucket.types.push(s.entry.type)
      }
      if (slices.length) buckets.set(dr.start, bucket)
      day = dr.end
    }
  }
  return buckets
}

export interface HistoryFilter {
  text: string
  type: string | null
  category: string | null
  // YYYY-MM-DD local dates; bounds are inclusive whole days.
  from: string | null
  to: string | null
}

export const EMPTY_FILTER: HistoryFilter = { text: '', type: null, category: null, from: null, to: null }

export function isFilterEmpty(f: HistoryFilter): boolean {
  return f.text.trim() === '' && f.type === null && f.category === null && f.from === null && f.to === null
}

// Parses a YYYY-MM-DD day bound; returns the local ms timestamp or null when
// the value is absent/invalid (an invalid bound simply doesn't filter).
export function dayBound(iso: string | null | undefined, endOfDay: boolean): number | null {
  if (iso == null || iso === '') return null
  const parts = iso.split('-').map(Number)
  const [y, m, d] = parts
  if (y === undefined || m === undefined || d === undefined || y < 1970 || m < 1 || m > 12 || d < 1 || d > 31) return null
  const date = new Date(y, m - 1, d)
  if (Number.isNaN(date.getTime())) return null
  const day = dayRange(date.getTime())
  return endOfDay ? day.end : day.start
}

export function filterEntries(entries: readonly TimeEntry[], f: HistoryFilter): TimeEntry[] {
  const text = f.text.trim().toLowerCase()
  const from = dayBound(f.from, false)
  const to = dayBound(f.to, true)
  return entries.filter((e) => {
    if (f.type !== null && e.type !== f.type) return false
    if (f.category !== null && e.category !== f.category) return false
    // An entry belongs to the range when it overlaps any of the bounded days:
    // cross-midnight sessions count toward every day they touch.
    const end = e.end ?? Number.MAX_SAFE_INTEGER
    if (from !== null && end <= from) return false
    if (to !== null && e.start >= to) return false
    if (text !== '') {
      const haystack = `${e.description ?? ''} ${e.category ?? ''} ${e.type}`.toLowerCase()
      if (!haystack.includes(text)) return false
    }
    return true
  })
}
