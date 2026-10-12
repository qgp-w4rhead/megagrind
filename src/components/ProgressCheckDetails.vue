<script setup lang="ts">
import { computed } from 'vue'
import { useMegagrindStore } from '../stores/megagrind'
import { formatCountdown } from '../domain/time'

const store = useMegagrindStore()

const redCount = computed(() => store.progressCheck.redCount)
const isFocusMode = computed(() => store.progressCheck.focusModeUntil !== null)
const focusModeRemaining = computed(() => {
  if (!store.progressCheck.focusModeUntil) return 0
  return Math.max(0, store.progressCheck.focusModeUntil - store.now)
})
const snoozeRemaining = computed(() => {
  if (!store.progressCheck.snoozeUntil) return 0
  return Math.max(0, store.progressCheck.snoozeUntil - store.now)
})
const isPaused = computed(() => !isFocusMode.value && store.progressCheck.pausedReason === 'not-working')

const alertMessage = computed(() => {
  if (store.alertError) return store.alertError
  if (store.alertsPermission === 'granted') {
    return store.settings.notificationsEnabled ? 'Browser alerts on' : 'Browser alerts are allowed, but turned off in settings.'
  }
  if (store.alertsPermission === 'denied') return 'Browser alerts are blocked. Allow notifications for this site in your browser settings.'
  return null
})

</script>

<template>
  <section class="check-details" data-test="progress-details" aria-label="Progress check details">
    <h3 class="check-details-title">Progress checks</h3>
    <p class="progress-status">
      <span v-if="isFocusMode" class="focus-info"><span class="focus-time">Focus {{ formatCountdown(focusModeRemaining) }}</span></span>
      <span v-else-if="store.progressCheck.snoozeUntil !== null" class="snooze-info"><span class="snooze-time">Snoozed {{ formatCountdown(snoozeRemaining) }}</span></span>
      <span v-else-if="isPaused" class="paused-info"><span class="paused-label">Paused</span><span class="sr-only"> while not working</span></span>
      <span v-else class="timer-info"><span class="next-check">Next {{ formatCountdown(store.progressTimeRemaining ?? 0) }}</span></span>
    </p>
    <dl class="progress-counts">
      <div>
        <dt>Blocked checks recorded today</dt>
        <dd data-test="blocked-today">{{ store.todayBlockedCount }}</dd>
      </div>
      <div>
        <dt>Blocked streak</dt>
        <dd data-test="blocked-streak">{{ redCount }}</dd>
      </div>
    </dl>
    <div v-if="redCount >= 3 && store.currentWorkSessionId" class="break-note" data-test="break-suggestion">
      <p class="break-text">Several blocked checks in a row — a short break may help, or you can keep going.</p>
      <button type="button" class="btn-action" data-test="take-break" @click="store.takeBreak('move')">
        Start a walk (switches to Move)
      </button>
    </div>
    <p v-if="store.breakReturnType !== null && store.isRunning" class="break-note" data-test="resume-hint">
      On a break — when you're back, <button type="button" class="link-btn" data-test="resume-from-break" @click="store.resumeFromBreak()">resume the previous activity</button> or pick another.
    </p>
    <button
      v-if="store.alertsPermission === 'default'"
      type="button"
      class="btn-action"
      data-test="enable-alerts"
      :disabled="store.alertRequestPending"
      @click="store.requestBrowserAlerts()"
    >
      {{ store.alertRequestPending ? 'Requesting permission...' : 'Enable browser alerts' }}
    </button>
    <p v-if="alertMessage" class="alerts-status" role="status" data-test="alert-status">{{ alertMessage }}</p>
  </section>
</template>

<style scoped>
.check-details {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  margin-top: 2rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--border-color);
}

.check-details-title {
  margin: 0 0 0.25rem 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--accent-purple);
}

.progress-status {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.875rem;
  line-height: 1.3;
  white-space: nowrap;
}

.next-check,
.snooze-time,
.focus-time {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}

.progress-counts {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 24px;
  margin: 0;
}

.progress-counts dt {
  color: var(--text-muted);
  font-size: 0.875rem;
}

.progress-counts dd {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 1.25rem;
  font-variant-numeric: tabular-nums;
}

.alerts-status {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.9375rem;
}

.break-note {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  color: var(--text-muted);
  font-size: 0.9375rem;
}

.break-note .break-text {
  margin: 0;
}

.break-note .link-btn {
  border: none;
  background: none;
  padding: 0;
  font: inherit;
  color: var(--accent-purple);
  cursor: pointer;
}

.break-note .link-btn:hover {
  text-decoration: underline;
}
</style>
