<script setup lang="ts">
import { computed } from 'vue'
import { useMegagrindStore } from '../stores/megagrind'
import { formatCountdown } from '../domain/time'
import { BellOff } from 'lucide-vue-next'

const store = useMegagrindStore()

const isFocusMode = computed(() => store.progressCheck.focusModeUntil !== null)
const focusModeRemaining = computed(() => {
  if (!store.progressCheck.focusModeUntil) return 0
  return Math.max(0, store.progressCheck.focusModeUntil - store.now)
})

function toggleFocusMode() {
  if (isFocusMode.value) {
    store.disableFocusMode()
  } else {
    store.enableFocusMode()
  }
}
</script>

<template>
  <button
    type="button"
    class="btn-action focus-toggle"
    data-test="focus-toggle"
    :aria-pressed="isFocusMode ? 'true' : 'false'"
    :title="isFocusMode ? 'End focus' : 'Focus — silence progress check-ins'"
    @click="toggleFocusMode"
  >
    <BellOff :size="16" aria-hidden="true" />
    <span v-if="isFocusMode" class="focus-toggle-time" data-test="focus-remaining">{{ formatCountdown(focusModeRemaining) }}</span>
    <span v-else>Focus</span>
  </button>
</template>

<style scoped>
.focus-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  white-space: nowrap;
}

.focus-toggle[aria-pressed="true"] {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.focus-toggle-time {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}
</style>
