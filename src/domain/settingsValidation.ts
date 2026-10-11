import type { Settings } from '../types'

export type SettingsErrors = Partial<Record<'allocations' | 'allocationTotal' | 'weekRolloverDay' | 'weekRolloverHour' | 'focusModeDuration' | 'progressCheckInterval', string>>

const MAX_WEEK_HOURS = 168

function isWholeNumberIn(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

export function validateSettings(settings: Settings): SettingsErrors {
  const errors: SettingsErrors = {}
  const allocations = Object.values(settings.weeklyAllocations)
  if (allocations.some((v) => typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > MAX_WEEK_HOURS)) {
    errors.allocations = 'Each allocation must be a number from 0 to 168 hours.'
  } else if (allocations.reduce((sum, v) => sum + v, 0) > MAX_WEEK_HOURS) {
    errors.allocationTotal = 'Allocations together cannot exceed 168 hours in a week.'
  }
  if (!isWholeNumberIn(settings.weekRolloverDay, 0, 6)) {
    errors.weekRolloverDay = 'Choose a rollover day.'
  }
  if (!isWholeNumberIn(settings.weekRolloverHour, 0, 23)) {
    errors.weekRolloverHour = 'Rollover hour must be a whole hour from 0 to 23.'
  }
  if (!isWholeNumberIn(settings.focusModeDuration, 15, 180)) {
    errors.focusModeDuration = 'Focus duration must be a whole number of minutes from 15 to 180.'
  }
  if (!isWholeNumberIn(settings.progressCheckInterval, 5, 60)) {
    errors.progressCheckInterval = 'Check interval must be a whole number of minutes from 5 to 60.'
  }
  return errors
}

export function hasSettingsErrors(errors: SettingsErrors): boolean {
  return Object.keys(errors).length > 0
}
