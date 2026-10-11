import { TRACKER_LABELS } from '../types'

export function activityLabel(type: string): string {
  return Object.prototype.hasOwnProperty.call(TRACKER_LABELS, type) ? TRACKER_LABELS[type]! : type
}
