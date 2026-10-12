import type { Goal } from '../types'

// Goal policies per the M5.1 contract:
//   none    — no goal; the activity is untracked against a plan.
//   target  — a weekly aim the user wants to reach (e.g. 40h work).
//   minimum — a floor to protect (e.g. sleep, movement).
//   budget  — a ceiling to stay under (e.g. chores).
// Only active policies count toward the weekly capacity sum, and goals never
// absorb leftover hours — unplanned time stays honestly unplanned.
export const GOAL_POLICIES = ['none', 'target', 'minimum', 'budget'] as const
export type GoalPolicy = Goal['policy']

export const WEEK_HOURS = 168

export const GOAL_POLICY_LABELS: Record<GoalPolicy, string> = {
  none: 'No goal',
  target: 'Weekly target',
  minimum: 'Weekly minimum',
  budget: 'Weekly budget',
}

export function isGoalActive(goal: Goal | undefined): boolean {
  return !!goal && goal.policy !== 'none'
}

export function goalHoursError(hours: unknown): string | null {
  if (typeof hours !== 'number' || !Number.isFinite(hours) || hours < 0 || hours > WEEK_HOURS) {
    return 'Goal hours must be a number from 0 to 168.'
  }
  return null
}

// Per-activity errors keyed by activity id, for field-level display.
export function validateGoals(goals: Record<string, Goal>): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const [id, goal] of Object.entries(goals)) {
    if (!goal || !GOAL_POLICIES.includes(goal.policy)) {
      errors[id] = 'Choose a goal type.'
      continue
    }
    if (goal.policy === 'none') continue
    const hoursError = goalHoursError(goal.hours)
    if (hoursError) errors[id] = hoursError
  }
  return errors
}

export function plannedGoalHours(goals: Record<string, Goal>): number {
  return Object.values(goals)
    .filter(isGoalActive)
    .reduce((sum, g) => sum + (Number.isFinite(g.hours) ? g.hours : 0), 0)
}

export function goalCapacity(goals: Record<string, Goal>): {
  planned: number
  free: number
  overBy: number
} {
  const planned = plannedGoalHours(goals)
  return {
    planned,
    free: Math.max(0, WEEK_HOURS - planned),
    overBy: Math.max(0, planned - WEEK_HOURS),
  }
}
