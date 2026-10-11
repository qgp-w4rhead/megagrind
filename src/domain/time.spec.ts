import { describe, it, expect } from 'vitest'
import { isTimeAdjustment, sliceEntry, sliceEntries, totalDuration, coveredDuration, dayRange, weekRange } from './time'
import type { TimeEntry, TimeRange } from '../types'

const H = 3_600_000

function entry(overrides: Partial<TimeEntry>): TimeEntry {
  return {
    id: overrides.id ?? `e-${Math.random().toString(36).slice(2, 8)}`,
    type: 'work',
    start: 0,
    end: null,
    ...overrides,
  }
}

describe('isTimeAdjustment', () => {
  it('treats reversed legacy entries as signed adjustments', () => {
    expect(isTimeAdjustment(entry({ start: 7000, end: 5000, isCorrection: true }))).toBe(true)
  })

  it('treats a balanced correction as an adjustment but an unpaired positive manual entry as a real interval', () => {
    expect(isTimeAdjustment(entry({ start: 9000, end: 10000, isCorrection: true, balancedWith: 'x' }))).toBe(true)
    expect(isTimeAdjustment(entry({ start: 1000, end: 5000, isCorrection: true }))).toBe(false)
  })
})

describe('sliceEntry', () => {
  it('clips a midnight-spanning entry to each local day', () => {
    const e = entry({ start: new Date(2026, 8, 8, 23).getTime(), end: new Date(2026, 8, 9, 1).getTime() })
    const now = new Date(2026, 8, 10, 12).getTime()
    expect(sliceEntry(e, dayRange(new Date(2026, 8, 8, 12).getTime()), now)?.duration).toBe(H)
    expect(sliceEntry(e, dayRange(new Date(2026, 8, 9, 12).getTime()), now)?.duration).toBe(H)
  })

  it('gives no interval when the entry only touches a day boundary', () => {
    const now = new Date(2026, 8, 10, 12).getTime()
    const endsAtStart = entry({ start: new Date(2026, 8, 8, 22).getTime(), end: new Date(2026, 8, 9, 0).getTime() })
    const startsAtEnd = entry({ start: new Date(2026, 8, 10, 0).getTime(), end: new Date(2026, 8, 10, 2).getTime() })
    const day9 = dayRange(new Date(2026, 8, 9, 12).getTime())
    expect(sliceEntry(endsAtStart, day9, now)).toBeNull()
    expect(sliceEntry(startsAtEnd, day9, now)).toBeNull()
  })

  it('excludes entries that start in the future', () => {
    const now = new Date(2026, 8, 9, 15).getTime()
    const future = entry({ start: now + 1000, end: null })
    expect(sliceEntry(future, dayRange(now), now)).toBeNull()
  })

  it('returns no slice for nonfinite or reversed ranges', () => {
    const e = entry({ start: 1000, end: 5000 })
    expect(sliceEntry(e, { start: NaN, end: 10 }, 10000)).toBeNull()
    expect(sliceEntry(e, { start: 10, end: 5 }, 10000)).toBeNull()
    expect(sliceEntry(e, { start: 0, end: Infinity }, 10000)).toBeNull()
  })

  it('an open entry contributes its live elapsed time exactly once', () => {
    const e = entry({ start: 1000, end: null })
    const range: TimeRange = { start: 0, end: 10000 }
    expect(sliceEntry(e, range, 4000)).toEqual({ entry: e, start: 1000, end: 4000, duration: 3000, isAdjustment: false, isRunning: true })
    expect(totalDuration([e], range, 4000)).toBe(3000)
    expect(coveredDuration(sliceEntries([e], range, 4000))).toBe(3000)
  })
})

describe('numeric contract over [0, 10000) at now 10000', () => {
  const range: TimeRange = { start: 0, end: 10000 }
  const now = 10000
  const a = entry({ id: 'a', start: 1000, end: 5000 })
  const b = entry({ id: 'b', start: 3000, end: 7000 })

  it('overlapping intervals sum to 8000 and cover 6000', () => {
    expect(totalDuration([a, b], range, now)).toBe(8000)
    expect(coveredDuration(sliceEntries([a, b], range, now))).toBe(6000)
  })

  it('a reversed correction nets against the total but not the coverage', () => {
    const adj = entry({ id: 'adj', start: 8000, end: 7000, isCorrection: true })
    expect(totalDuration([a, b, adj], range, now)).toBe(7000)
    expect(coveredDuration(sliceEntries([a, b, adj], range, now))).toBe(6000)
  })

  it('a paired positive adjustment adds time but not coverage', () => {
    const paired = entry({ id: 'paired', start: 9000, end: 10000, isCorrection: true, balancedWith: 'a' })
    expect(totalDuration([a, b, paired], range, now)).toBe(9000)
    expect(coveredDuration(sliceEntries([a, b, paired], range, now))).toBe(6000)
  })

  it('an unpaired positive manual correction is a real 4000 interval', () => {
    const manual = entry({ id: 'manual', start: 1000, end: 5000, isCorrection: true })
    expect(totalDuration([manual], range, now)).toBe(4000)
    expect(coveredDuration(sliceEntries([manual], range, now))).toBe(4000)
  })
})

describe('dayRange and weekRange', () => {
  it('spans one local calendar day with an exclusive end at next midnight', () => {
    expect(dayRange(new Date(2026, 8, 9, 15).getTime())).toEqual({
      start: new Date(2026, 8, 9).getTime(),
      end: new Date(2026, 8, 10).getTime(),
    })
  })

  it('starts the week at the configured rollover day and hour', () => {
    expect(weekRange(new Date(2026, 8, 9, 15).getTime(), 0, 0).start).toBe(new Date(2026, 8, 6).getTime())
    expect(weekRange(new Date(2026, 8, 6, 6).getTime(), 0, 9).start).toBe(new Date(2026, 7, 30, 9).getTime())
  })
})

const isNewYork = Intl.DateTimeFormat().resolvedOptions().timeZone === 'America/New_York'

describe.skipIf(!isNewYork)('America/New_York DST boundaries', () => {
  it('a nonexistent rollover hour does not make adjacent weeks overlap', () => {
    const previous = weekRange(Date.parse('2026-03-11T16:00:00Z'), 0, 2)
    const next = weekRange(Date.parse('2026-03-15T06:00:00Z'), 0, 2)
    expect(previous.start).toBe(Date.parse('2026-03-08T07:00:00Z'))
    expect(previous.end).toBe(Date.parse('2026-03-15T06:00:00Z'))
    expect(previous.end).toBe(next.start)
  })

  it('a spring-forward day lasts 23 hours', () => {
    const r = dayRange(Date.parse('2026-03-08T16:00:00Z'))
    expect(r.end - r.start).toBe(23 * H)
  })

  it('a fall-back day lasts 25 hours', () => {
    const r = dayRange(Date.parse('2026-11-01T17:00:00Z'))
    expect(r.end - r.start).toBe(25 * H)
  })

  it('a spring-forward week lasts 167 hours', () => {
    const r = weekRange(new Date(2026, 2, 11, 12).getTime(), 0, 0)
    expect(r).toEqual({ start: new Date(2026, 2, 8).getTime(), end: new Date(2026, 2, 15).getTime() })
    expect(r.end - r.start).toBe(167 * H)
  })

  it('a fall-back week lasts 169 hours', () => {
    const r = weekRange(new Date(2026, 10, 4, 12).getTime(), 0, 0)
    expect(r).toEqual({ start: new Date(2026, 10, 1).getTime(), end: new Date(2026, 10, 8).getTime() })
    expect(r.end - r.start).toBe(169 * H)
  })
})
