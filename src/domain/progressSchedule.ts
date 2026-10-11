export type PausedReason = 'not-working' | 'focus'

export interface ProgressState {
  lastCheck: number | null
  redCount: number
  snoozeUntil: number | null
  focusModeUntil: number | null
  nextCheckAt: number | null
  remainingMs: number | null
  pendingSessionId: string | null
  pausedReason: PausedReason | null
  sessionId: string | null
}

export interface ProgressContext {
  now: number
  workId: string | null
  enabled: boolean
  intervalMs: number
}

export interface ProgressReconciled {
  state: ProgressState
  skipped: string[]
}

export const PROGRESS_DEFAULTS: ProgressState = {
  lastCheck: null,
  redCount: 0,
  snoozeUntil: null,
  focusModeUntil: null,
  nextCheckAt: null,
  remainingMs: null,
  pendingSessionId: null,
  pausedReason: null,
  sessionId: null,
}

const SNOOZE_MS = 30 * 60 * 1000

function sameDay(a: number, b: number): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString()
}

function remainingAt(s: ProgressState, ctx: ProgressContext): number {
  return s.nextCheckAt !== null ? Math.max(0, s.nextCheckAt - ctx.now) : (s.remainingMs ?? ctx.intervalMs)
}

function freshSession(s: ProgressState, ctx: ProgressContext): ProgressReconciled {
  return {
    state: {
      ...s,
      pendingSessionId: null,
      sessionId: ctx.workId,
      nextCheckAt: ctx.now + ctx.intervalMs,
      remainingMs: null,
      pausedReason: null,
      snoozeUntil: null,
    },
    skipped: s.pendingSessionId === null ? [] : [s.pendingSessionId],
  }
}

function endFocus(s: ProgressState, ctx: ProgressContext, resumeAt: number): ProgressReconciled {
  const state = { ...s, focusModeUntil: null }
  if (ctx.workId !== null && ctx.workId === s.sessionId) {
    return {
      state: {
        ...state,
        nextCheckAt: s.pendingSessionId === null ? resumeAt + (s.remainingMs ?? ctx.intervalMs) : null,
        remainingMs: null,
        pausedReason: null,
      },
      skipped: [],
    }
  }
  if (ctx.workId !== null) return freshSession(state, ctx)
  return {
    state: { ...state, nextCheckAt: null, remainingMs: s.remainingMs ?? ctx.intervalMs, pausedReason: 'not-working' },
    skipped: [],
  }
}

function pause(s: ProgressState, ctx: ProgressContext): ProgressState {
  if (s.pausedReason === 'not-working' && s.nextCheckAt === null) return s
  return { ...s, remainingMs: remainingAt(s, ctx), nextCheckAt: null, snoozeUntil: null, pausedReason: 'not-working' }
}

function resume(s: ProgressState, ctx: ProgressContext): ProgressState {
  if (s.pendingSessionId !== null) return { ...s, remainingMs: null, pausedReason: null }
  return { ...s, nextCheckAt: ctx.now + (s.remainingMs ?? ctx.intervalMs), remainingMs: null, pausedReason: null }
}

export function reconcileProgressState(input: ProgressState, ctx: ProgressContext): ProgressReconciled {
  if (!ctx.enabled) {
    return {
      state: {
        ...input,
        nextCheckAt: null,
        pendingSessionId: null,
        snoozeUntil: null,
        focusModeUntil: null,
        remainingMs: null,
        pausedReason: null,
        sessionId: null,
      },
      skipped: [],
    }
  }
  const adopt = input.sessionId === null && ctx.workId !== null &&
    (input.nextCheckAt !== null || input.focusModeUntil !== null || input.snoozeUntil !== null)
  const base: ProgressState = adopt ? { ...input, sessionId: ctx.workId } : input
  let result: ProgressReconciled = { state: base, skipped: [] }
  // Clear focus mode if its end time has passed (tab was closed).
  if (base.focusModeUntil !== null && base.focusModeUntil <= ctx.now) {
    result = endFocus(base, ctx, base.focusModeUntil)
  }
  let state = result.state
  const skipped = [...result.skipped]
  // Clear snooze if it has expired (tab was closed).
  if (state.snoozeUntil !== null && state.snoozeUntil <= ctx.now) {
    state = { ...state, snoozeUntil: null, nextCheckAt: state.nextCheckAt ?? state.snoozeUntil }
  }
  // Reset redCount if the last check was on a previous day.
  if (state.lastCheck !== null && !sameDay(state.lastCheck, ctx.now)) {
    state = { ...state, redCount: 0 }
  }
  if (state.focusModeUntil === null) {
    if (ctx.workId === null) {
      state = pause(state, ctx)
    } else if (state.sessionId !== ctx.workId) {
      // If a work session starts while the timer is already expired (e.g. the tab
      // was idle for a long time, or data was cleared), reset to a fresh interval
      // instead of firing the prompt on the very next tick.
      const fresh = freshSession(state, ctx)
      state = fresh.state
      skipped.push(...fresh.skipped)
    } else if (state.pausedReason !== null) {
      state = resume(state, ctx)
    }
    if (
      ctx.workId !== null &&
      state.sessionId === ctx.workId &&
      state.pausedReason === null &&
      state.pendingSessionId === null &&
      state.nextCheckAt !== null &&
      state.nextCheckAt <= ctx.now
    ) {
      // Prevent notification spam: reset timer so we don't fire every tick
      // while the prompt is visible. The prompt handler calls resetTimer().
      state = { ...state, pendingSessionId: ctx.workId, nextCheckAt: null }
    }
  }
  return { state, skipped }
}

export function answerProgressState(s: ProgressState, ctx: ProgressContext, madeProgress: boolean): ProgressState {
  const redCount = madeProgress ? 0 : s.redCount + 1
  if (ctx.workId === null) return { ...s, redCount, lastCheck: ctx.now }
  return {
    ...s,
    redCount,
    lastCheck: ctx.now,
    sessionId: ctx.workId,
    pendingSessionId: null,
    snoozeUntil: null,
    nextCheckAt: ctx.now + ctx.intervalMs,
    remainingMs: null,
    pausedReason: null,
  }
}

export function snoozeProgressState(s: ProgressState, ctx: ProgressContext): ProgressState {
  if (ctx.workId === null) return s
  const until = ctx.now + SNOOZE_MS
  return {
    ...s,
    sessionId: ctx.workId,
    pendingSessionId: null,
    snoozeUntil: until,
    nextCheckAt: until,
    remainingMs: null,
    pausedReason: null,
  }
}

export function enableFocusState(s: ProgressState, ctx: ProgressContext, focusMs: number): ProgressState {
  if (s.focusModeUntil !== null) return s
  return {
    ...s,
    remainingMs: remainingAt(s, ctx),
    nextCheckAt: null,
    snoozeUntil: null,
    focusModeUntil: ctx.now + focusMs,
    pausedReason: 'focus',
  }
}

export function disableFocusState(s: ProgressState, ctx: ProgressContext): ProgressState {
  if (s.focusModeUntil === null) return s
  return endFocus(s, ctx, ctx.now).state
}

export function applyIntervalState(s: ProgressState, ctx: ProgressContext): ProgressState {
  if (s.snoozeUntil !== null) return s
  if (s.focusModeUntil !== null || s.pausedReason !== null) return { ...s, remainingMs: ctx.intervalMs }
  if (s.nextCheckAt !== null) return { ...s, nextCheckAt: ctx.now + ctx.intervalMs }
  return s
}
