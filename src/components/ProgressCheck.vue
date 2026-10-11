<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useMegagrindStore } from '../stores/megagrind'
import { CheckCircle, XCircle, Square } from 'lucide-vue-next'
import AppDialog from './AppDialog.vue'

const store = useMegagrindStore()
const yesButton = ref<HTMLButtonElement | null>(null)

const isFocusMode = computed(() => store.progressCheck.focusModeUntil !== null)
const showPrompt = computed(() => store.isProgressPromptDue && !isFocusMode.value)
const intervalMinutes = computed(() => store.settings.progressCheckInterval)

watch(showPrompt, async (visible) => {
  if (!visible) return
  await nextTick()
  yesButton.value?.focus()
})

function handleProgress(madeProgress: boolean) {
  store.recordProgressCheck(madeProgress)
}

function snooze() {
  store.snoozeProgressCheck()
}

function stopFromPrompt() {
  store.stopSession()
}
</script>

<template>
  <AppDialog :show="showPrompt" title="Progress Check" :dismissible="false" data-test="progress-check">
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
