<script setup lang="ts">
import { computed } from 'vue'
import { useMegagrindStore } from '../stores/megagrind'
import NowBar from '../components/NowBar.vue'
import SessionTracker from '../components/SessionTracker.vue'
import ProgressCheck from '../components/ProgressCheck.vue'

const store = useMegagrindStore()

const trackerTypes = computed(() => {
  const builtIn = [
    'work',
    'chores',
    'sleep',
    'cook',
    'shower',
    'move',
    'leisure',
    'unexpected',
    'buffer',
  ]
  const custom = store.settings.customChronos ?? []
  const types = [...builtIn, ...custom]
  if (store.settings.idleTimeEnabled) types.push('idle')
  return types
})
</script>

<template>
  <div class="track-view">
    <div class="now-row">
      <NowBar data-test="now-bar" />
      <ProgressCheck v-if="store.settings.progressCheckEnabled" />
    </div>
    <div class="trackers-grid">
      <SessionTracker
        v-for="type in trackerTypes"
        :key="type"
        :type="type"
        :data-test="`tracker-${type}`"
      />
    </div>
  </div>
</template>

<style scoped>
.track-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.now-row {
  display: flex;
  gap: 12px;
  align-items: stretch;
  flex-wrap: wrap;
}

.now-row > * {
  flex: 1;
  min-width: 260px;
}

.trackers-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
}
</style>
