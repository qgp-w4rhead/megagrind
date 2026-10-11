<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useMegagrindStore } from '../stores/megagrind'
import { CheckCircle, XCircle, Coffee, Bell, Square } from 'lucide-vue-next'
import AppDialog from './AppDialog.vue'

const store = useMegagrindStore()
const yesButton = ref<HTMLButtonElement | null>(null)

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
const showPrompt = computed(() => store.isProgressPromptDue && !isFocusMode.value)
const intervalMinutes = computed(() => store.settings.progressCheckInterval)

watch(showPrompt, async (visible) => {
  if (!visible) return
  await nextTick()
  yesButton.value?.focus()
})

const alertMessage = computed(() => {
  if (store.alertError) return store.alertError
  if (store.alertsPermission === 'granted') {
    return store.settings.notificationsEnabled ? 'Browser alerts on' : 'Browser alerts are allowed, but turned off in settings.'
  }
  if (store.alertsPermission === 'denied') return 'Browser alerts are blocked. Allow notifications for this site in your browser settings.'
  return null
})

function formatTime(ms: number): string {
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function handleProgress(madeProgress: boolean) {
  store.recordProgressCheck(madeProgress)
}

function snooze() {
  store.snoozeProgressCheck()
}

function stopFromPrompt() {
  store.stopSession()
}

function toggleFocusMode() {
  if (isFocusMode.value) {
    store.disableFocusMode()
  } else {
    store.enableFocusMode()
  }
}
</script>

<template>
  <section class="progress-check" data-test="progress-check" aria-labelledby="progress-check-title">
    <div class="progress-row">
      <div class="progress-copy">
        <h2 id="progress-check-title" class="progress-title">Progress check</h2>
        <p class="progress-status">
          <span v-if="isFocusMode" class="focus-info"><span class="focus-time">Focus {{ formatTime(focusModeRemaining) }}</span></span>
          <span v-else-if="store.progressCheck.snoozeUntil !== null" class="snooze-info"><span class="snooze-time">Snoozed {{ formatTime(snoozeRemaining) }}</span></span>
          <span v-else-if="isPaused" class="paused-info"><span class="paused-label">Paused</span><span class="sr-only"> while not working</span></span>
          <span v-else class="timer-info"><span class="next-check">Next {{ formatTime(store.progressTimeRemaining ?? 0) }}</span></span>
        </p>
      </div>
      <button type="button" class="btn-action focus-toggle" :aria-pressed="isFocusMode ? 'true' : 'false'" @click="toggleFocusMode">
        <Coffee v-if="isFocusMode" :size="16" aria-hidden="true" />
        <Bell v-else :size="16" aria-hidden="true" />
        {{ isFocusMode ? 'End focus' : 'Focus' }}
      </button>
    </div>

    <details class="progress-details">
      <summary>Details</summary>
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
      <p v-if="redCount >= 3 && store.currentWorkSessionId" class="break-note">
        Several blocked checks in a row. A short break may help.
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
    </details>
  </section>

  <AppDialog :show="showPrompt" title="Progress Check" :dismissible="false">
    <div class="prompt-card">
      <p>Did you make progress in the last {{ intervalMinutes }} minutes?</p>
      <div class="prompt-actions">
        <button ref="yesButton" type="button" class="btn-primary" @click="handleProgress(true)">
          <CheckCircle :size="18" aria-hidden="true" />
          Made progress
        </button>
        <button type="button" class="btn-action" @click="handleProgress(false)">
          <XCircle :size="18" aria-hidden="true" />
          I'm blocked
        </button>
        <button type="button" class="btn-action" @click="snooze">Snooze 30 min</button>
        <button type="button" class="btn-action" data-test="prompt-stop" @click="stopFromPrompt">
          <Square :size="14" aria-hidden="true" />
          Stop activity
        </button>
      </div>
    </div>
  </AppDialog>
</template>

<style scoped>
.progress-check {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 12px;
  border: 1px solid var(--color-border-subtle);
  border-radius: 12px;
  background: var(--color-surface);
  color: var(--color-text);
  min-width: 0;
}

.progress-row {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}

.progress-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1 1 auto;
}

.progress-title {
  font-family: var(--font-display);
  font-size: 0.9375rem;
  font-weight: 650;
  line-height: 1.3;
}

.progress-status {
  color: var(--color-text-muted);
  font-size: 0.875rem;
  line-height: 1.3;
  white-space: nowrap;
}

.next-check,
.snooze-time,
.focus-time {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  color: var(--color-text);
}

.focus-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  white-space: nowrap;
}

.progress-details summary {
  min-height: 44px;
  display: flex;
  align-items: center;
  cursor: pointer;
  color: var(--color-text-muted);
}

.progress-details[open] {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.progress-counts {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 24px;
}

.progress-counts dt {
  color: var(--color-text-muted);
  font-size: 0.875rem;
}

.progress-counts dd {
  font-family: var(--font-mono);
  font-size: 1.25rem;
  font-variant-numeric: tabular-nums;
}

.alerts-status,
.break-note {
  color: var(--color-text-muted);
  font-size: 0.9375rem;
}

.prompt-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  color: var(--color-text);
}

.prompt-card p {
  color: var(--color-text);
}

.prompt-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.prompt-actions button {
  justify-content: center;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
}
</style>
