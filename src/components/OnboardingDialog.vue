<script setup lang="ts">
import { computed, ref } from 'vue'
import { useMegagrindStore } from '../stores/megagrind'
import AppDialog from './AppDialog.vue'
import { activityChoices, favoriteActivities, FAVORITE_LIMIT } from '../domain/activities'
import { activityLabel } from '../domain/labels'
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
  gap: 4px 14px;
  margin: 0 0 14px;
  padding: 0;
  list-style: none;
  font-size: 0.8125rem;
  color: var(--color-text-muted);
}
.onboarding-steps li[aria-current='step'] {
  color: var(--color-text);
  font-weight: 650;
}
.onboarding-step p {
  margin: 0 0 12px;
  font-size: 0.9375rem;
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
  font-size: 0.8125rem;
  color: var(--color-text-muted);
  margin-bottom: 6px;
}
.onboarding-radio {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  padding: 6px 12px;
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
  font-size: 0.875rem;
}
.onboarding-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.onboarding-row label {
  font-size: 0.875rem;
  color: var(--color-text-muted);
}
.onboarding-row select,
.onboarding-row input {
  min-height: 44px;
  font-size: 1rem;
}
.onboarding-row input {
  width: 72px;
}
.onboarding-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.onboarding-chip {
  min-height: 44px;
  padding: 8px 14px;
  border-radius: 999px;
  border: 1px solid var(--color-border-subtle);
  background: var(--color-surface-raised);
  color: var(--color-text);
  font-size: 0.875rem;
}
.onboarding-chip.is-chosen {
  border-color: var(--color-primary);
  background: var(--color-primary);
  color: var(--color-on-primary);
}
.onboarding-chip:disabled:not(.is-chosen) {
  opacity: 0.5;
}
.onboarding-hint {
  font-size: 0.8125rem;
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
}
.onboarding-goal-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1 1 240px;
  font-size: 0.875rem;
}
.onboarding-hours {
  width: 84px;
  min-height: 44px;
  font-size: 1rem;
}
.field-error {
  color: var(--color-danger);
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
