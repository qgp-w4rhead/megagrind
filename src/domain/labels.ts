import { TRACKER_LABELS, type ActivityDefinition } from '../types'

// Definition labels win so renames and archived custom activities keep their
// chosen name in history; built-in table and the raw id are the fallbacks.
export function activityLabel(type: string, defined: readonly ActivityDefinition[] = []): string {
  const def = defined.find((d) => d.id === type)
  if (def && def.label.trim().length > 0) return def.label
  return Object.prototype.hasOwnProperty.call(TRACKER_LABELS, type) ? TRACKER_LABELS[type]! : type
}
