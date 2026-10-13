<script setup lang="ts">
import { computed, ref } from 'vue'
import { useMegagrindStore } from '../stores/megagrind'
import AppDialog from './AppDialog.vue'
import { activityChoices, favoriteActivities, FAVORITE_LIMIT } from '../domain/activities'
import { activityLabel } from '../domain/labels'
import { getTrackerConfig } from '../config/trackers'
import { goalCapacity, GOAL_POLICY_LABELS, validateGoals, type GoalPolicy } from '../domain/goals'
import type { Goal, Settings, TrackerType } from '../types'

const store = useMegagrindStore()

const step = ref(0)
const darkMode = ref<Settings['darkMode']>(store.settings.darkMode)
const weekRolloverDay = ref(store.settings.weekRolloverDay)
const weekRolloverHour = ref(store.settings.weekRolloverHour)

// Favorites pre-check what the user already sees (recency/fallback picks), so
// finishing without touching anything changes nothing.
const chosenFavorites = ref<Set<TrackerType>>(
  new Set(favoriteActivities(store.entries, store.settings.activities)),
)
const allActivities = computed(() =>
  activityChoices(store.settings.customChronos, store.entries.map((e) => e.type), store.settings.activities),
)

// Suggested policies only — every goal is opt-in, nothing is imposed.
const suggestions: { id: TrackerType; policy: GoalPolicy; hours: number; hint: string }[] = [
  { id: 'work', policy: 'target', hours: 40, hint: 'A weekly amount to aim for' },
  { id: 'sleep', policy: 'minimum', hours: 49, hint: 'A floor to protect' },
  { id: 'move', policy: 'minimum', hours: 3.5, hint: 'A floor to protect' },
  { id: 'chores', policy: 'budget', hours: 7, hint: 'A ceiling to stay under' },
]
const goalDraft = ref<Record<string, Goal | null>>(
  Object.fromEntries(suggestions.map((s) => [s.id, null])),
)
const goalHours = ref<Record<string, number>>(
  Object.fromEntries(suggestions.map((s) => [s.id, s.hours])),
)

const chosenGoals = computed<Record<string, Goal>>(() => {
  const out: Record<string, Goal> = {}
  for (const s of suggestions) {
    if (goalDraft.value[s.id]) {
      out[s.id] = { policy: s.policy, hours: goalHours.value[s.id] ?? s.hours }
    }
  }
  return out
})
const goalErrors = computed(() => validateGoals(chosenGoals.value))
const capacity = computed(() => goalCapacity(chosenGoals.value))
const lastStep = 3

function accentOf(type: TrackerType): string {
  return getTrackerConfig(type).accent
}

function toggleFavorite(type: TrackerType) {
  const next = new Set(chosenFavorites.value)
  if (next.has(type)) next.delete(type)
  else if (next.size < FAVORITE_LIMIT) next.add(type)
  chosenFavorites.value = next
}

function skip() {
  store.completeOnboarding()
}

function finish() {
  store.completeOnboarding({
    favorites: [...chosenFavorites.value],
    goals: chosenGoals.value,
    weekRolloverDay: weekRolloverDay.value,
    weekRolloverHour: weekRolloverHour.value,
    darkMode: darkMode.value,
  })
}
</script>

<template>
  <AppDialog :show="true" title="Set up MegaGrind" @close="skip">
    <ol class="onboarding-steps" aria-label="Setup progress">
      <li :aria-current="step === 0 ? 'step' : undefined">Welcome</li>
      <li :aria-current="step === 1 ? 'step' : undefined">Week start</li>
      <li :aria-current="step === 2 ? 'step' : undefined">Favorites</li>
      <li :aria-current="step === 3 ? 'step' : undefined">Goals</li>
    </ol>

    <section v-if="step === 0" class="onboarding-step">
      <p>
        MegaGrind stores everything <strong>on this device</strong> — no account, nothing leaves
        your browser unless you set up an optional private server in Settings later.
      </p>
      <p>You can start tracking right away; every choice here is also in Settings.</p>
      <fieldset class="onboarding-field">
        <legend>Theme</legend>
        <label class="onboarding-radio">
          <input v-model="darkMode" type="radio" value="auto" /> Match system
        </label>
        <label class="onboarding-radio">
          <input v-model="darkMode" type="radio" value="light" /> Light
        </label>
        <label class="onboarding-radio">
          <input v-model="darkMode" type="radio" value="dark" /> Dark
        </label>
      </fieldset>
    </section>

    <section v-else-if="step === 1" class="onboarding-step">
      <p>When does your tracking week start?</p>
      <div class="onboarding-row">
        <label for="onboard-day">Day</label>
        <select id="onboard-day" v-model.number="weekRolloverDay">
          <option :value="0">Sunday</option>
          <option :value="1">Monday</option>
          <option :value="2">Tuesday</option>
          <option :value="3">Wednesday</option>
          <option :value="4">Thursday</option>
          <option :value="5">Friday</option>
          <option :value="6">Saturday</option>
        </select>
        <label for="onboard-hour">Hour</label>
        <input id="onboard-hour" v-model.number="weekRolloverHour" type="number" min="0" max="23" />
      </div>
    </section>

    <section v-else-if="step === 2" class="onboarding-step">
      <p>
        Pick up to {{ FAVORITE_LIMIT }} favorite activities for one-tap starts on Today.
        Everything stays available in the full picker.
      </p>
      <div class="onboarding-chips" role="group" aria-label="Favorite activities">
        <button
          v-for="type in allActivities"
          :key="type"
          type="button"
          class="onboarding-chip"
          :class="{ 'is-chosen': chosenFavorites.has(type) }"
          :style="{ '--activity-accent': accentOf(type) }"
          :aria-pressed="chosenFavorites.has(type)"
          :disabled="!chosenFavorites.has(type) && chosenFavorites.size >= FAVORITE_LIMIT"
          @click="toggleFavorite(type)"
        >
          {{ activityLabel(type, store.settings.activities) }}
        </button>
      </div>
      <p class="onboarding-hint">{{ chosenFavorites.size }} / {{ FAVORITE_LIMIT }} chosen</p>
    </section>

    <section v-else class="onboarding-step">
      <p>Optional weekly goals. Choose any that help — none are set unless you enable them.</p>
      <div class="onboarding-goals">
        <div v-for="s in suggestions" :key="s.id" class="onboarding-goal">
          <label class="onboarding-goal-toggle">
            <input
              type="checkbox"
              :checked="goalDraft[s.id] !== null"
              @change="goalDraft[s.id] = ($event.target as HTMLInputElement).checked ? { policy: s.policy, hours: goalHours[s.id] ?? s.hours } : null"
            />
            <span>
              <strong>{{ activityLabel(s.id, store.settings.activities) }}</strong> — {{ GOAL_POLICY_LABELS[s.policy] }}.
              {{ s.hint }}.
            </span>
          </label>
          <input
            v-if="goalDraft[s.id]"
            v-model.number="goalHours[s.id]"
            type="number"
            min="0"
            max="168"
            step="0.5"
            class="onboarding-hours"
            :aria-label="`${activityLabel(s.id, store.settings.activities)} weekly hours`"
          />
        </div>
      </div>
      <p v-if="Object.keys(goalErrors).length" class="field-error" role="alert">
        {{ Object.values(goalErrors)[0] }}
      </p>
      <p v-else-if="capacity.planned > 0" class="onboarding-hint">
        Planned: {{ capacity.planned }}h of 168h
        <template v-if="capacity.overBy > 0"> — {{ capacity.overBy }}h over a week’s capacity.</template>
        <template v-else> — {{ capacity.free }}h stays unplanned.</template>
      </p>
    </section>

    <template #footer>
      <div class="onboarding-footer">
        <button type="button" class="btn-action" data-test="onboarding-skip" @click="skip">
          Skip setup
        </button>
        <div class="onboarding-nav">
          <button v-if="step > 0" type="button" class="btn-action" data-test="onboarding-back" @click="step--">
            Back
          </button>
          <button
            v-if="step < lastStep"
            type="button"
            class="btn-primary"
            data-test="onboarding-next"
            @click="step++"
          >
            Next
          </button>
          <button
            v-else
            type="button"
            class="btn-primary"
            data-test="onboarding-done"
            :disabled="capacity.overBy > 0"
            @click="finish"
          >
            Done
          </button>
        </div>
      </div>
    </template>
  </AppDialog>
</template>

<style scoped>
.onboarding-steps {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 18px;
  margin: 0 0 16px;
  padding: 0 0 12px;
  list-style: none;
  counter-reset: step;
  border-bottom: 1px solid var(--hairline);
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}
.onboarding-steps li {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.onboarding-steps li::before {
  counter-increment: step;
  content: counter(step, decimal-leading-zero);
  font-size: 0.625rem;
  opacity: 0.75;
}
.onboarding-steps li[aria-current='step'] {
  color: var(--color-primary);
  font-weight: 650;
}
.onboarding-step p {
  margin: 0 0 12px;
  font-size: 0.9375rem;
  line-height: 1.55;
}
.onboarding-field {
  border: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.onboarding-field legend {
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  margin-bottom: 8px;
}
.onboarding-radio {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  padding: 8px 14px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-control);
  background: var(--control-bg);
  font-size: 0.875rem;
  cursor: pointer;
}
.onboarding-radio:hover {
  border-color: var(--color-border);
}
.onboarding-radio:has(input:checked) {
  border-color: var(--color-primary);
  background: color-mix(in oklch, var(--color-primary), transparent 88%);
}
.onboarding-radio input {
  accent-color: var(--color-primary);
  margin: 0;
}
.onboarding-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.onboarding-row label {
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.1em;
}
.onboarding-row select,
.onboarding-row input {
  min-height: 44px;
  padding: 8px 10px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-control);
  background: var(--control-bg);
  color: var(--color-text);
  font: inherit;
  font-size: 1rem;
}
.onboarding-row select:focus,
.onboarding-row input:focus {
  outline: none;
  border-color: var(--color-primary);
}
.onboarding-row input {
  width: 76px;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}
.onboarding-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.onboarding-chip {
  --activity-accent: var(--color-border);
  min-height: 44px;
  padding: 8px 16px;
  border-radius: 999px;
  border: 1px solid var(--hairline);
  background: var(--control-bg);
  color: var(--color-text);
  font: inherit;
  font-size: 0.875rem;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.onboarding-chip:hover:not(:disabled) {
  border-color: var(--activity-accent);
}
.onboarding-chip.is-chosen {
  border-color: var(--activity-accent);
  background: color-mix(in oklch, var(--activity-accent), transparent 82%);
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--activity-accent), transparent 55%);
}
.onboarding-chip:disabled:not(.is-chosen) {
  opacity: 0.45;
}
.onboarding-hint {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  color: var(--color-text-muted);
}
.onboarding-goals {
  display: grid;
  gap: 10px;
}
.onboarding-goal {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 10px 12px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-control);
  background: var(--control-bg);
}
.onboarding-goal-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1 1 240px;
  font-size: 0.875rem;
  line-height: 1.45;
}
.onboarding-goal-toggle input {
  width: 18px;
  height: 18px;
  accent-color: var(--color-primary);
  flex-shrink: 0;
}
.onboarding-hours {
  width: 84px;
  min-height: 44px;
  padding: 8px 10px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-control);
  background: var(--color-surface);
  color: var(--color-text);
  font-family: var(--font-mono);
  font-size: 1rem;
  font-variant-numeric: tabular-nums;
}
.onboarding-hours:focus {
  outline: none;
  border-color: var(--color-primary);
}
.field-error {
  color: var(--color-danger-text);
  font-size: 0.8125rem;
}
.onboarding-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.onboarding-nav {
  display: flex;
  gap: 8px;
}
</style>
