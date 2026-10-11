import { watch } from 'vue'
import type { useMegagrindStore } from '../stores/megagrind'

type ProgressStore = ReturnType<typeof useMegagrindStore>

function notifyPromptDue(store: ProgressStore) {
  try {
    if (!store.settings.notificationsEnabled || !('Notification' in globalThis)) return
    if (Notification.permission !== 'granted') return
    new Notification('MEGAGRIND', {
      body: `Progress check: did you make progress in the last ${store.settings.progressCheckInterval} minutes?`,
      icon: '/favicon.ico',
    })
  } catch (err) {
    store.reportAlertFailure('Browser alert could not be shown. The in-app prompt still works.')
    console.warn('[megagrind] Browser alert failed', err)
  }
}

export function useProgressScheduler(store: ProgressStore) {
  const stops = [
    watch(() => store.now, () => store.reconcileProgress(), { flush: 'sync' }),
    watch(
      () => [
        store.settings.progressCheckEnabled,
        store.currentWorkSessionId,
        store.progressCheck.focusModeUntil,
        store.progressCheck.snoozeUntil,
      ],
      () => store.reconcileProgress(),
      { flush: 'sync' },
    ),
    // Re-sync the local countdown when nextCheckAt is changed externally
    // (e.g. by "Clear All Data" resetting it to null). Without this, the local
    // ref keeps its stale value across reloads and after data wipes.
    watch(() => store.progressCheck.nextCheckAt, () => store.reconcileProgress(), { flush: 'sync' }),
    watch(() => store.settings.progressCheckInterval, () => store.applyProgressIntervalChange(), { flush: 'sync' }),
    watch(
      () => store.progressCheck.pendingSessionId,
      (pending) => {
        if (pending !== null) notifyPromptDue(store)
      },
      { flush: 'sync' },
    ),
  ]
  store.reconcileProgress()
  return () => stops.forEach((stop) => stop())
}
