import type { Component } from 'vue'
import type { TrackerType, Settings } from '../types'
import { TRACKER_LABELS } from '../types'
import {
  Moon,
  Utensils,
  Droplets,
  WashingMachine,
  Footprints,
  Wine,
  AlertTriangle,
  Coffee,
  Briefcase,
  Clock,
} from 'lucide-vue-next'

export interface TrackerConfig {
  label: string
  icon: Component
  accent: string
  /** Resolve selectable categories from settings (work, chores). */
  categories?: (settings: Settings) => string[]
  /** Block session start until a description is entered (work, unexpected). */
  requiresDescription?: boolean
  /** No start/stop button — elapsed is derived from the open entry (idle). */
  passive?: boolean
}

export const TRACKER_CONFIG: Record<string, TrackerConfig> = {
  sleep: { label: 'Sleep', icon: Moon, accent: '#7c6cf0' },
  cook: { label: 'Cook/Eat', icon: Utensils, accent: '#f09a5a' },
  shower: { label: 'Shower', icon: Droplets, accent: '#4fb8d4' },
  chores: {
    label: 'Chores',
    icon: WashingMachine,
    accent: '#5ac88a',
    categories: (s) => s.choreCategories,
  },
  move: { label: 'Move', icon: Footprints, accent: '#e0c04f' },
  leisure: { label: 'Leisure', icon: Wine, accent: '#d45a9e' },
  unexpected: {
    label: 'Unexpected',
    icon: AlertTriangle,
    accent: '#e05a5a',
    requiresDescription: true,
  },
  idle: { label: 'Idle Time', icon: Coffee, accent: '#8a8f98', passive: true },
  work: {
    label: 'Work',
    icon: Briefcase,
    accent: '#4f8ef0',
    categories: (s) => s.workCategories,
    requiresDescription: true,
  },
}

export function getTrackerConfig(type: TrackerType): TrackerConfig {
  return (
    TRACKER_CONFIG[type] ?? {
      label:
        TRACKER_LABELS[type] ?? type.charAt(0).toUpperCase() + type.slice(1),
      icon: Clock,
      accent: '#8a8f98',
    }
  )
}
