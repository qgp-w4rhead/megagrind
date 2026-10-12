import { describe, expect, it } from 'vitest'
import {
  categoryTotals,
  comparisonFor,
  coverageOf,
  dayBuckets,
  filterEntries,
  goalProgressForPeriod,
  isFilterEmpty,
  periodRange,
  shiftPeriodAnchor,
  typeTotals,
  EMPTY_FILTER,
} from './insights'
import { sliceEntries, dayRange, weekRange } from './time'
import type { TimeEntry } from '../types'

const T = (s: string) => Date.parse(s)
// All fixtures below land on Monday 2026-10-12 (America/New_York in CI-independent
// local terms — use plain Date math for ranges and explicit ms for entries).

function entry(id: string, type: string, start: number, end: number | null, extra: Partial<TimeEntry> = {}): TimeEntry {
  return { id, type, start, end, ...extra }
}

const NOW = T('2026-10-14T18:00:00Z') // Wednesday — current week is incomplete

describe('period navigation', () => {
  it('day and week ranges are half-open local intervals honoring the rollover', () => {
    const d = periodRange('day', NOW, 0, 0)
    expect(d.end - d.start).toBe(24 * 3600000)
    const w = periodRange('week', NOW, 0, 0)
    expect(w.end - w.start).toBe(7 * 24 * 3600000)
    expect(w.start).toBe(weekRange(NOW, 0, 0).start)
    // Custom week boundary: Monday rollover.
    const monday = periodRange('week', NOW, 1, 0)
    expect(new Date(monday.start).getDay()).toBe(1)
  })

  it('shifting moves by whole periods across DST-length irregularities', () => {
    const w = periodRange('week', NOW, 0, 0)
    const prev = shiftPeriodAnchor('week', w.start + 12 * 3600000, -1)
    const prevRange = periodRange('week', prev, 0, 0)
    expect(prevRange.end).toBe(w.start)
    const d = periodRange('day', NOW, 0, 0)
    const nextDay = periodRange('day', shiftPeriodAnchor('day', d.start + 12 * 3600000, 1), 0, 0)
    expect(nextDay.start).toBe(d.end)
  })
})

describe('typeTotals and coverage', () => {
  it('sums slices per type including signed corrections', () => {
    const range = periodRange('day', NOW, 0, 0)
    const entries = [
      entry('a', 'work', range.start + 3600000, range.start + 2 * 3600000),
      entry('b', 'sleep', range.start, range.start + 6 * 3600000),
      // +30min correction earlier in the day (must precede `now` to count).
      entry('c', 'work', range.start + 10 * 3600000, range.start + 10.5 * 3600000, { isCorrection: true, balancedWith: 'x' }),
    ]
    const slices = sliceEntries(entries, range, NOW)
    const totals = typeTotals(slices)
    const work = totals.find((t) => t.type === 'work')
    expect(work?.totalMs).toBeCloseTo(1.5 * 3600000)
    const cov = coverageOf(slices, range, NOW)
    expect(cov.elapsedMs).toBe(NOW - range.start)
    // coveredDuration union: work 1-2h overlaps sleep 0-6h, so union = 6h.
    expect(cov.trackedMs).toBe(6 * 3600000)
    expect(cov.untrackedMs).toBe(cov.elapsedMs - cov.trackedMs)
    expect(cov.adjustmentMs).toBe(1800000)
  })

  it('cross-midnight slices attribute to both days without duplicating the entry', () => {
    // 22:00 → 03:00 local, built from real day boundaries (TZ-independent).
    const dayStart = dayRange(T('2026-10-12T12:00:00Z')).start
    const overnight = entry('night', 'sleep', dayStart - 2 * 3600000, dayStart + 3 * 3600000)
    const buckets = dayBuckets([overnight], { start: dayStart - 86400000, end: dayStart + 2 * 86400000 }, NOW)
    expect(buckets.get(dayStart - 86400000)?.totalMs).toBe(2 * 3600000)
    expect(buckets.get(dayStart)?.totalMs).toBe(3 * 3600000)
    expect(buckets.get(dayStart - 86400000)?.types).toEqual(['sleep'])
  })
})

describe('categoryTotals', () => {
  it('groups by type:category and skips uncategorized slices', () => {
    const range = periodRange('week', NOW, 0, 0)
    const entries = [
      entry('a', 'work', range.start + 3600000, range.start + 2 * 3600000, { category: 'dev' }),
      entry('b', 'work', range.start + 3 * 3600000, range.start + 4 * 3600000, { category: 'dev' }),
      entry('c', 'work', range.start + 5 * 3600000, range.start + 6 * 3600000),
      entry('d', 'chores', range.start + 7 * 3600000, range.start + 8 * 3600000, { category: 'laundry' }),
    ]
    const cats = categoryTotals(sliceEntries(entries, range, NOW))
    expect(cats.find((c) => c.key === 'work:dev')?.totalMs).toBe(2 * 3600000)
    expect(cats.find((c) => c.key === 'chores:laundry')?.totalMs).toBe(3600000)
    expect(cats.some((c) => c.key.includes('work:undefined'))).toBe(false)
  })
})

describe('goalProgressForPeriod', () => {
  const totals = [
    { type: 'work', totalMs: 45 * 3600000, slices: 5 },
    { type: 'sleep', totalMs: 50 * 3600000, slices: 3 },
    { type: 'chores', totalMs: 8 * 3600000, slices: 4 },
  ]

  it('reports met/under/over per policy without inventing failure language', () => {
    const rows = goalProgressForPeriod(
      {
        work: { policy: 'target', hours: 40 },
        sleep: { policy: 'minimum', hours: 56 },
        chores: { policy: 'budget', hours: 7 },
        leisure: { policy: 'none', hours: 0 },
      },
      totals,
    )
    expect(rows.find((r) => r.id === 'work')?.state).toBe('met')
    expect(rows.find((r) => r.id === 'sleep')?.state).toBe('under')
    expect(rows.find((r) => r.id === 'chores')?.state).toBe('over')
    expect(rows.some((r) => r.id === 'leisure')).toBe(false)
  })

  it('empty goals produce no rows; unknown activity ids get zero progress', () => {
    expect(goalProgressForPeriod({}, totals)).toEqual([])
    const rows = goalProgressForPeriod({ writing: { policy: 'target', hours: 5 } }, totals)
    expect(rows[0]?.actualMs).toBe(0)
    expect(rows[0]?.state).toBe('under')
  })
})

describe('comparisonFor', () => {
  it('an incomplete current week compares only the same elapsed slice of last week', () => {
    const range = periodRange('week', NOW, 0, 0)
    const c = comparisonFor('week', range, NOW, 0, 0)
    expect(c.complete).toBe(false)
    expect(c.compareRange.start).toBe(c.previousRange.start)
    const elapsed = NOW - range.start
    expect(c.compareRange.end - c.compareRange.start).toBe(elapsed)
    expect(c.compareRange.end).toBeLessThan(c.previousRange.end)
  })

  it('a finished week compares the full previous week', () => {
    const lastWeekAnchor = NOW - 8 * 86400000
    const range = periodRange('week', lastWeekAnchor, 0, 0)
    const c = comparisonFor('week', range, NOW, 0, 0)
    expect(c.complete).toBe(true)
    expect(c.compareRange).toEqual(c.previousRange)
  })
})

describe('filterEntries', () => {
  const entries = [
    entry('1', 'work', 1, 2, { description: 'Shipped the parser', category: 'dev' }),
    entry('2', 'chores', 3, 4, { description: 'Dishes', category: 'kitchen' }),
    entry('3', 'sleep', 5, 6),
  ]

  it('filters by text across description/category/type, case-insensitively', () => {
    expect(filterEntries(entries, { ...EMPTY_FILTER, text: 'PARSER' })).toHaveLength(1)
    expect(filterEntries(entries, { ...EMPTY_FILTER, text: 'kitchen' })).toHaveLength(1)
    expect(filterEntries(entries, { ...EMPTY_FILTER, text: 'work' })).toHaveLength(1)
  })

  it('bounds by inclusive local days; cross-midnight sessions touch both ends', () => {
    const d1 = dayRange(T('2026-10-10T12:00:00Z')).start
    const d2 = d1 + 86400000
    const iso = (ms: number) => {
      const d = new Date(ms)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }
    const night = entry('night', 'sleep', d2 - 2 * 3600000, d2 + 3 * 3600000)
    const day1Only = filterEntries([night], { ...EMPTY_FILTER, from: iso(d1), to: iso(d1) })
    const day2Only = filterEntries([night], { ...EMPTY_FILTER, from: iso(d2), to: iso(d2) })
    expect(day1Only).toHaveLength(1)
    expect(day2Only).toHaveLength(1)
    const outside = filterEntries([night], { ...EMPTY_FILTER, from: iso(d1 + 2 * 86400000), to: iso(d1 + 3 * 86400000) })
    expect(outside).toHaveLength(0)
    expect(isFilterEmpty({ ...EMPTY_FILTER, from: iso(d1) })).toBe(false)
  })

  it('filters by type and category, composes with text', () => {
    expect(filterEntries(entries, { ...EMPTY_FILTER, type: 'chores' })).toEqual([entries[1]])
    expect(filterEntries(entries, { ...EMPTY_FILTER, category: 'dev' })).toEqual([entries[0]])
    expect(filterEntries(entries, { ...EMPTY_FILTER, text: 'parser', type: 'chores' })).toHaveLength(0)
    expect(isFilterEmpty(EMPTY_FILTER)).toBe(true)
    expect(isFilterEmpty({ ...EMPTY_FILTER, text: 'x' })).toBe(false)
  })
})

describe('long-history fixture', () => {
  // Deterministic synthetic history: 400 days x 4 entries = 1600 entries.
  const DAY = 86400000
  const base = dayRange(T('2025-06-01T12:00:00Z')).start
  const big: TimeEntry[] = []
  for (let d = 0; d < 400; d++) {
    const day = base + d * DAY
    big.push(entry(`w${d}`, 'work', day + 9 * 3600000, day + 17 * 3600000, { description: `shift ${d}` }))
    big.push(entry(`s${d}`, 'sleep', day - 2 * 3600000, day + 6 * 3600000))
    big.push(entry(`c${d}`, 'chores', day + 18 * 3600000, day + 19 * 3600000, { category: 'laundry' }))
    big.push(entry(`l${d}`, 'leisure', day + 20 * 3600000, day + 21 * 3600000))
  }
  const now = base + 400 * DAY

  it('dayBuckets produces at most one bucket per day for a month window', () => {
    const monthStart = new Date(2025, 9, 1).getTime()
    const monthEnd = new Date(2025, 10, 1).getTime()
    const buckets = dayBuckets(big, { start: monthStart, end: monthEnd }, now)
    expect(buckets.size).toBeLessThanOrEqual(31)
    const oct5 = dayRange(new Date(2025, 9, 5).getTime()).start
    const b = buckets.get(oct5)
    expect(b?.types).toContain('work')
    expect(b?.totalMs).toBeGreaterThan(0)
  })

  it('filters stay correct over the whole set', () => {
    expect(filterEntries(big, { ...EMPTY_FILTER, type: 'work' })).toHaveLength(400)
    expect(filterEntries(big, { ...EMPTY_FILTER, text: 'shift 42' })).toHaveLength(1)
    expect(filterEntries(big, { ...EMPTY_FILTER, category: 'laundry' })).toHaveLength(400)
  })
})
