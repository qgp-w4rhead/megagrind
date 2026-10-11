import type { TrackerType } from './index'

export interface StartActivityEvent {
  type: TrackerType
  description?: string
  category?: string
}

export interface EntryRef {
  id: string
}

export interface AddEntryEvent {
  type?: TrackerType
}
