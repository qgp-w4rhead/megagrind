import { ref, computed, onScopeDispose, unref, type Ref } from 'vue'
import { useMegagrindStore } from '../stores/megagrind'
import type { TrackerType } from '../types'

/**
 * Shared timer state for a tracker type. An "open" entry (end === null) of
 * the given type means it is running — this unifies active sessions and the
 * passive idle tracker, which is just an open idle entry.
 */
export function useSessionTimer(type: TrackerType | Ref<TrackerType>) {
  const store = useMegagrindStore()
  const trackerType = computed(() => unref(type))

  const now = ref(Date.now())
  const interval = setInterval(() => {
    now.value = Date.now()
  }, 1000)
  onScopeDispose(() => clearInterval(interval))

  const openEntry = computed(
    () =>
      store.entries.find(
        (e) => e.type === trackerType.value && e.end === null,
      ) ?? null,
  )

  const isRunning = computed(() => openEntry.value !== null)

  const elapsed = computed(() => {
    if (!openEntry.value) return 0
    return Math.max(0, now.value - openEntry.value.start)
  })

  const todayTotal = computed(() =>
    store.getTotalTimeForTypeAndDay(
      trackerType.value,
      store.getDayStart(),
      store.getDayEnd(),
    ),
  )

  const weekTotal = computed(() => store.getTotalTimeForType(trackerType.value))

  // Today's finished entries, newest first. getEntriesByTypeAndDay already
  // excludes the open entry (end !== null filter).
  const history = computed(() =>
    store
      .getEntriesByTypeAndDay(
        trackerType.value,
        store.getDayStart(),
        store.getDayEnd(),
      )
      .slice()
      .sort((a, b) => b.start - a.start),
  )

  function start(description?: string, category?: string) {
    store.startSession(trackerType.value, description, category)
  }

  function stop() {
    store.stopSession()
  }

  return { isRunning, elapsed, todayTotal, weekTotal, history, start, stop }
}
