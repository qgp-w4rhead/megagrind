import type { TimeEntry, TrackerType } from '../types'
import { isTimeAdjustment } from './time'

export const BUILT_IN_ACTIVITIES: TrackerType[] = [
  'work',
  'chores',
  'sleep',
  'cook',
  'shower',
  'move',
  'leisure',
  'unexpected',
  'buffer',
]

const FAVORITE_FALLBACKS: TrackerType[] = ['work', 'sleep', 'move', 'cook', 'chores', 'leisure']

export const FAVORITE_LIMIT = 6

export function activityChoices(customChronos: readonly string[], historyTypes: readonly string[] = []): TrackerType[] {
  const all = [...BUILT_IN_ACTIVITIES, ...customChronos, ...historyTypes]
  return [...new Set(all)].filter((t) => t !== 'idle')
}

export function favoriteActivities(entries: readonly TimeEntry[]): TrackerType[] {
  const recent = entries
    .filter((e) => e.type !== 'idle' && !isTimeAdjustment(e))
    .slice()
    .sort((a, b) => b.start - a.start)
  const result: TrackerType[] = []
  for (const e of recent) {
    if (result.length < FAVORITE_LIMIT && !result.includes(e.type)) result.push(e.type)
  }
  for (const type of FAVORITE_FALLBACKS) {
    if (result.length < FAVORITE_LIMIT && !result.includes(type)) result.push(type)
  }
  return result
}

export function lastCategory(entries: readonly TimeEntry[], type: TrackerType): string | undefined {
  const latest = entries
    .filter((e) => e.type === type && e.category)
    .slice()
    .sort((a, b) => b.start - a.start)[0]
  return latest?.category
}
