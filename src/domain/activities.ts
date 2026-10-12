import type { ActivityDefinition, TimeEntry, TrackerType } from '../types'
import { TRACKER_LABELS } from '../types'
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

function displayLabel(type: TrackerType): string {
  return Object.prototype.hasOwnProperty.call(TRACKER_LABELS, type)
    ? TRACKER_LABELS[type]!
    : type.charAt(0).toUpperCase() + type.slice(1)
}

// Merged activity definitions: the stored list wins; built-ins, custom
// chronos, and any type observed in history that lacks a definition are
// appended in stable order. Unknown/custom ids are preserved.
export function activityDefinitions(
  customChronos: readonly string[],
  historyTypes: readonly string[],
  defined: readonly ActivityDefinition[] = [],
): ActivityDefinition[] {
  const out = defined.map((d) => ({ ...d }))
  const known = new Set(out.map((d) => d.id))
  let order = out.reduce((max, d) => Math.max(max, d.order), -1) + 1
  for (const t of [...BUILT_IN_ACTIVITIES, ...customChronos, ...historyTypes]) {
    if (t === 'idle' || known.has(t)) continue
    out.push({ id: t, label: displayLabel(t), favorite: false, archived: false, order: order++ })
    known.add(t)
  }
  return out.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
}

export function activityChoices(
  customChronos: readonly string[],
  historyTypes: readonly string[] = [],
  defined: readonly ActivityDefinition[] = [],
): TrackerType[] {
  return activityDefinitions(customChronos, historyTypes, defined)
    .filter((d) => d.id !== 'idle' && !d.archived)
    .map((d) => d.id)
}

// Explicit favorites first (in definition order), then recency/history fills
// the rest — so existing users keep their recency-driven list until they mark
// favorites themselves. Archived activities never appear.
export function favoriteActivities(
  entries: readonly TimeEntry[],
  defined: readonly ActivityDefinition[] = [],
): TrackerType[] {
  const byId = new Map(defined.map((d) => [d.id, d]))
  const result: TrackerType[] = defined
    .filter((d) => d.favorite && !d.archived)
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((d) => d.id)
    .slice(0, FAVORITE_LIMIT)
  const push = (type: TrackerType) => {
    if (result.length < FAVORITE_LIMIT && !result.includes(type) && !byId.get(type)?.archived) {
      result.push(type)
    }
  }
  const recent = entries
    .filter((e) => e.type !== 'idle' && !isTimeAdjustment(e))
    .slice()
    .sort((a, b) => b.start - a.start)
  for (const e of recent) push(e.type)
  for (const type of FAVORITE_FALLBACKS) push(type)
  return result
}

export function lastCategory(entries: readonly TimeEntry[], type: TrackerType): string | undefined {
  const latest = entries
    .filter((e) => e.type === type && e.category)
    .slice()
    .sort((a, b) => b.start - a.start)[0]
  return latest?.category
}
