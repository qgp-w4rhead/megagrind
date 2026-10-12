import { describe, expect, it } from 'vitest'
import { activityChoices, activityDefinitions, favoriteActivities, FAVORITE_LIMIT } from './activities'
import type { ActivityDefinition, TimeEntry } from '../types'

const def = (id: string, over: Partial<ActivityDefinition> = {}): ActivityDefinition => ({
  id,
  label: id,
  favorite: false,
  archived: false,
  order: 0,
  ...over,
})

const entry = (type: string, start: number): TimeEntry => ({ id: `${type}-${start}`, type, start, end: start + 1 })

describe('activityDefinitions', () => {
  it('merges built-ins, customs, and history-only types in stable order without dropping unknown ids', () => {
    const defs = activityDefinitions(['reading'], ['work', 'unknown-legacy'], [def('work', { favorite: true, order: 0 })])
    const ids = defs.map((d) => d.id)
    expect(ids).toContain('work')
    expect(ids).toContain('reading')
    expect(ids).toContain('unknown-legacy')
    expect(ids).toContain('sleep')
    expect(new Set(ids).size).toBe(ids.length)
    expect(defs.find((d) => d.id === 'work')?.favorite).toBe(true)
    expect(defs.find((d) => d.id === 'reading')?.label).toBe('Reading')
  })

  it('never produces a definition for the passive idle type', () => {
    const defs = activityDefinitions([], ['idle', 'work'], [])
    expect(defs.map((d) => d.id)).not.toContain('idle')
  })
})

describe('activityChoices', () => {
  it('lists built-ins, customs and history types minus idle and archived', () => {
    const choices = activityChoices(['reading'], ['side-project'], [def('chores', { archived: true })])
    expect(choices).toContain('work')
    expect(choices).toContain('reading')
    expect(choices).toContain('side-project')
    expect(choices).not.toContain('idle')
    expect(choices).not.toContain('chores')
  })

  it('orders choices by definition order so reordering reaches the picker', () => {
    const defined = [
      def('work', { order: 2 }),
      def('sleep', { order: 0 }),
      def('move', { order: 1 }),
    ]
    const choices = activityChoices([], [], defined)
    expect(choices.slice(0, 3)).toEqual(['sleep', 'move', 'work'])
  })
})

describe('favoriteActivities', () => {
  it('keeps recency-driven behavior when nothing is marked favorite', () => {
    const entries = [entry('leisure', 3), entry('work', 5), entry('sleep', 1)]
    const favs = favoriteActivities(entries, [def('work'), def('sleep')])
    expect(favs[0]).toBe('work')
    expect(favs.length).toBe(FAVORITE_LIMIT)
  })

  it('puts explicit favorites first in definition order, then fills from recency', () => {
    const defined = [
      def('move', { favorite: true, order: 2 }),
      def('sleep', { favorite: true, order: 0 }),
      def('work'),
    ]
    const entries = [entry('leisure', 9), entry('work', 8)]
    const favs = favoriteActivities(entries, defined)
    expect(favs.slice(0, 2)).toEqual(['sleep', 'move'])
    expect(favs[2]).toBe('leisure')
  })

  it('never surfaces archived activities even when favorited or recently used', () => {
    const defined = [def('work', { favorite: true, archived: true }), def('sleep', { archived: true })]
    const entries = [entry('work', 9), entry('sleep', 8)]
    const favs = favoriteActivities(entries, defined)
    expect(favs).not.toContain('work')
    expect(favs).not.toContain('sleep')
  })
})
