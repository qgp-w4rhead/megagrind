import { z } from 'zod'

export const trackerTypeSchema = z.string()

export const workCategorySchema = z.string()

export const timeEntrySchema = z.object({
  id: z.string(),
  type: trackerTypeSchema,
  start: z.number(),
  end: z.number().nullable(),
  category: z.string().optional(),
  description: z.string().optional(),
})

export const timeEntryCreateSchema = timeEntrySchema

export const timeEntryUpdateSchema = z.object({
  type: trackerTypeSchema.optional(),
  start: z.number().optional(),
  end: z.number().nullable().optional(),
  category: z.string().optional(),
  description: z.string().optional(),
})

export const settingsSchema = z.object({
  weeklyAllocations: z.record(z.string(), z.number()),
  customChronos: z.array(z.string()),
  choreCategories: z.array(z.string()),
  workCategories: z.array(z.string()),
  weekRolloverDay: z.number(),
  weekRolloverHour: z.number(),
  notificationsEnabled: z.boolean(),
  soundEnabled: z.boolean(),
  focusModeDuration: z.number(),
  darkMode: z.enum(['auto', 'light', 'dark']),
})

export const weekDataSchema = z.object({
  version: z.number(),
  weekStart: z.number(),
  entries: z.array(timeEntrySchema),
  settings: settingsSchema,
})

export const dbSwitchSchema = z.object({
  type: z.enum(['sqlite', 'mongodb']),
})
