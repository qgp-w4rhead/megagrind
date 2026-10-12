import { describe, expect, it } from 'vitest'
import { goalCapacity, goalHoursError, isGoalActive, plannedGoalHours, validateGoals } from './goals'
import type { Goal } from '../types'

const goal = (policy: Goal['policy'], hours: number): Goal => ({ policy, hours })

describe('goal policies', () => {
  it('accepts none/target/minimum/budget and rejects an unknown policy', () => {
    const errors = validateGoals({
      work: goal('target', 40),
      sleep: goal('minimum', 49),
      chores: goal('budget', 7),
      move: goal('none', 0),
      bogus: { policy: 'impossible', hours: 1 } as unknown as Goal,
    })
    expect(errors.bogus).toBeDefined()
    expect(errors.work).toBeUndefined()
    expect(errors.sleep).toBeUndefined()
    expect(errors.chores).toBeUndefined()
    expect(errors.move).toBeUndefined()
  })

  it('rejects non-finite, negative, and over-168 hours; allows decimals', () => {
    for (const hours of [NaN, Infinity, -1, 169, '40' as unknown as number]) {
      expect(goalHoursError(hours)).not.toBeNull()
      expect(validateGoals({ work: goal('target', hours as number) }).work).toBeDefined()
    }
    expect(goalHoursError(2.33)).toBeNull()
    expect(validateGoals({ shower: goal('minimum', 2.33) }).shower).toBeUndefined()
  })

  it('counts only active policies toward the weekly plan; none-policy hours are ignored', () => {
    const goals = {
      work: goal('target', 40),
      leisure: goal('none', 30),
      sleep: goal('minimum', 49),
    }
    expect(isGoalActive(goals.leisure)).toBe(false)
    expect(plannedGoalHours(goals)).toBe(89)
  })

  it('reports honest capacity: planned, free, and over-by against 168 hours', () => {
    const under = goalCapacity({ work: goal('target', 40), sleep: goal('minimum', 49) })
    expect(under).toEqual({ planned: 89, free: 79, overBy: 0 })
    const over = goalCapacity({ work: goal('target', 100), sleep: goal('minimum', 80) })
    expect(over.overBy).toBe(12)
    expect(over.free).toBe(0)
    const none = goalCapacity({})
    expect(none).toEqual({ planned: 0, free: 168, overBy: 0 })
  })
})
