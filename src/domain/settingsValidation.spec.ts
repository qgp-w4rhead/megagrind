import { describe, it, expect } from 'vitest'
import { validateSettings, hasSettingsErrors } from './settingsValidation'
import { createDefaultSettings } from '../types'

function withSettings(patch: (s: ReturnType<typeof createDefaultSettings>) => void) {
  const s = createDefaultSettings()
  patch(s)
  return s
}

describe('validateSettings', () => {
  it('accepts the defaults', () => {
    expect(hasSettingsErrors(validateSettings(createDefaultSettings()))).toBe(false)
  })

  it('blocks negative, non-finite and over-168 allocations', () => {
    expect(validateSettings(withSettings((s) => (s.weeklyAllocations.sleep = -1))).allocations).toBeDefined()
    expect(validateSettings(withSettings((s) => (s.weeklyAllocations.cook = Number.NaN))).allocations).toBeDefined()
    expect(validateSettings(withSettings((s) => (s.weeklyAllocations.move = 169))).allocations).toBeDefined()
  })

  it('blocks non-work allocations that together exceed 168 hours', () => {
    const errors = validateSettings(
      withSettings((s) => {
        s.weeklyAllocations = { sleep: 100, cook: 50, shower: 10, chores: 10, move: 0, leisure: 0, unexpected: 0, buffer: 0 }
      }),
    )
    expect(errors.allocationTotal).toBeDefined()
  })

  it('requires whole-number rollover, focus and interval values within their ranges', () => {
    expect(validateSettings(withSettings((s) => (s.weekRolloverDay = 7))).weekRolloverDay).toBeDefined()
    expect(validateSettings(withSettings((s) => (s.weekRolloverHour = 24))).weekRolloverHour).toBeDefined()
    expect(validateSettings(withSettings((s) => (s.weekRolloverHour = 1.5))).weekRolloverHour).toBeDefined()
    expect(validateSettings(withSettings((s) => (s.focusModeDuration = 14))).focusModeDuration).toBeDefined()
    expect(validateSettings(withSettings((s) => (s.focusModeDuration = 181))).focusModeDuration).toBeDefined()
    expect(validateSettings(withSettings((s) => (s.progressCheckInterval = 4))).progressCheckInterval).toBeDefined()
    expect(validateSettings(withSettings((s) => (s.progressCheckInterval = 61))).progressCheckInterval).toBeDefined()
  })

  it('rejects empty, over-long, or duplicate activity labels before save', () => {
    expect(validateSettings(withSettings((s) => (s.activities[0]!.label = '   '))).activities).toBeDefined()
    expect(validateSettings(withSettings((s) => (s.activities[0]!.label = 'x'.repeat(61)))).activities).toBeDefined()
    expect(
      validateSettings(withSettings((s) => (s.activities = [...s.activities, { ...s.activities[0]! }]))).activities,
    ).toBeDefined()
    expect(validateSettings(withSettings((s) => (s.activities[0]!.label = 'Deep Work'))).activities).toBeUndefined()
  })
})
