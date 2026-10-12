import { describe, it, expect } from 'vitest'
import { favoriteActivities, lastCategory, activityChoices } from './activities'
import { activityLabel } from './labels'
import { getTrackerConfig } from '../config/trackers'
import type { TrackerType } from '../types'
import { formatDuration, recentFinishedEntries, todayPresentation } from './today'
import { dayRange } from './time'
import type { TimeEntry } from '../types'

const H = 3_600_000
const day = new Date(2026, 8, 9).getTime()
const at = (h: number, m = 0) => day + h * H + m * 60_000

function entry(overrides: Partial<TimeEntry>): TimeEntry {
  return { id: 'e', type: 'work', start: 0, end: null, ...overrides }
}

describe('favoriteActivities', () => {
  it('lists recent distinct activities first, skips idle and corrections, and fills up to six deterministically', () => {
    const entries = [
      entry({ id: 'a', type: 'cook', start: at(8), end: at(9) }),
      entry({ id: 'b', type: 'idle', start: at(9), end: at(10) }),
      entry({ id: 'c', type: 'move', start: at(10), end: at(11) }),
      entry({ id: 'd', type: 'cook', start: at(11), end: at(12) }),
      entry({ id: 'x', type: 'leisure', start: at(12), end: at(11), isCorrection: true }),
    ]
    expect(favoriteActivities(entries)).toEqual(['cook', 'move', 'work', 'sleep', 'chores', 'leisure'])
  })

  it('keeps custom activities reachable through the full choices list but not as idle', () => {
    const choices = activityChoices(['Reading'])
    expect(choices).toContain('Reading')
    expect(choices).not.toContain('idle')
  })

  it('reuses the most recent category for a type', () => {
    const entries = [
      entry({ id: 'old', type: 'work', start: at(8), end: at(9), category: 'research' }),
      entry({ id: 'new', type: 'work', start: at(10), end: at(11), category: 'dev' }),
    ]
    expect(lastCategory(entries, 'work')).toBe('dev')
    expect(lastCategory(entries, 'chores')).toBeUndefined()
  })
})

describe('activity choices and safe labels', () => {
  it('deduplicates, drops idle even if a custom list contains it, and keeps unknown history types reachable', () => {
    const choices = activityChoices(['Reading', 'idle', 'Reading'], ['legacy-type', 'idle'])
    expect(choices.filter((t) => t === 'Reading')).toHaveLength(1)
    expect(choices).not.toContain('idle')
    expect(choices).toContain('legacy-type')
  })

  it('resolves prototype-named strings to their own text, not inherited values', () => {
    expect(activityLabel('constructor')).toBe('constructor')
    expect(getTrackerConfig('constructor' as TrackerType).label).toBe('Constructor')
    expect(activityLabel('work')).toBe('Work')
  })

  it('prefers definition labels so renames and archived customs stay readable in history', () => {
    const defined = [
      { id: 'work', label: 'Deep Work', favorite: false, archived: false, order: 0 },
      { id: 'my-hobby', label: 'Pottery', favorite: false, archived: true, order: 1 },
    ]
    expect(activityLabel('work', defined)).toBe('Deep Work')
    expect(activityLabel('my-hobby', defined)).toBe('Pottery')
    expect(activityLabel('sleep', defined)).toBe('Sleep')
    expect(activityLabel('unlisted')).toBe('unlisted')
    // A blanked-out label falls back rather than rendering nothing.
    expect(activityLabel('work', [{ ...defined[0]!, label: '  ' }])).toBe('Work')
  })
})

describe('todayPresentation', () => {
  it('positions ribbon segments from the calendar day length', () => {
    const now = at(13)
    const pres = todayPresentation([entry({ id: 'w', start: at(9), end: at(10) })], now)
    const span = dayRange(now).end - dayRange(now).start
    expect(pres.segments).toHaveLength(1)
    expect(pres.segments[0]!.leftPct).toBeCloseTo((9 * H / span) * 100)
    expect(pres.segments[0]!.widthPct).toBeCloseTo((H / span) * 100)
  })

  it('counts a signed correction in net but never in ribbon geometry', () => {
    const now = at(13)
    const pres = todayPresentation(
      [
        entry({ id: 'w', start: at(9), end: at(11) }),
        entry({ id: 'adj', start: at(12), end: at(11), isCorrection: true }),
      ],
      now,
    )
    expect(pres.segments.map((s) => s.id)).toEqual(['w'])
    expect(pres.covered).toBe(2 * H)
    expect(pres.net).toBe(H)
  })

  it('warns when normal intervals overlap and never reports the overlap sum as coverage', () => {
    const now = at(13)
    const pres = todayPresentation(
      [entry({ id: 'a', start: at(9), end: at(11) }), entry({ id: 'b', start: at(10), end: at(12) })],
      now,
    )
    expect(pres.normalSum).toBe(4 * H)
    expect(pres.covered).toBe(3 * H)
    expect(pres.overlap).toBe(true)
    expect(pres.untracked).toBe(10 * H)
  })

  it('excludes intervals that have not started yet', () => {
    const pres = todayPresentation([entry({ id: 'future', start: at(20), end: at(21) })], at(13))
    expect(pres.segments).toHaveLength(0)
    expect(pres.covered).toBe(0)
  })

  it('shows a running interval live up to now', () => {
    const pres = todayPresentation([entry({ id: 'run', start: at(9), end: null })], at(10))
    expect(pres.segments[0]!.isRunning).toBe(true)
    expect(pres.covered).toBe(H)
  })
})

describe('recentFinishedEntries and formatDuration', () => {
  it('returns only finished entries, newest first, bounded by the limit', () => {
    const entries = [
      entry({ id: 'open', start: at(12), end: null }),
      entry({ id: 'a', start: at(8), end: at(9) }),
      entry({ id: 'b', start: at(10), end: at(11) }),
    ]
    expect(recentFinishedEntries(entries, 1).map((e) => e.id)).toEqual(['b'])
  })

  it('formats durations with hours and minutes', () => {
    expect(formatDuration(90 * 60_000)).toBe('1h 30m')
    expect(formatDuration(12 * 60_000)).toBe('12m')
    expect(formatDuration(-30 * 60_000)).toBe('-30m')
  })
})
