<script setup lang="ts">
import { ref, watch, nextTick, onBeforeUnmount, useId } from 'vue'

const props = withDefaults(defineProps<{ show: boolean; title: string; dismissible?: boolean }>(), {
  dismissible: true,
})
const emit = defineEmits<{ close: [] }>()

const titleId = `${useId()}-title`
const dialogEl = ref<HTMLDialogElement | null>(null)
let returnFocusTo: HTMLElement | null = null

function openDialog(d: HTMLDialogElement) {
  returnFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
  if (typeof d.showModal === 'function') {
    if (!d.open) d.showModal()
  } else {
    d.setAttribute('open', '')
  }
}

function closeDialog(d: HTMLDialogElement) {
  if (typeof d.close === 'function') {
    if (d.open) d.close()
  } else {
    d.removeAttribute('open')
  }
  returnFocusTo?.focus?.()
  returnFocusTo = null
}

watch(
  () => props.show,
  async (open) => {
    await nextTick()
    const d = dialogEl.value
    if (!d) return
    if (open) openDialog(d)
    else closeDialog(d)
  },
  { immediate: true },
)

function onCancel(event: Event) {
  event.preventDefault()
  if (props.dismissible) emit('close')
}

onBeforeUnmount(() => {
  const d = dialogEl.value
  if (d && props.show) closeDialog(d)
})
</script>

<template>
  <dialog ref="dialogEl" class="app-dialog" :aria-labelledby="titleId" @cancel="onCancel">
    <div class="app-dialog-panel">
      <header class="app-dialog-header">
        <h2 :id="titleId" class="app-dialog-title">{{ title }}</h2>
        <button
          v-if="dismissible"
          type="button"
          class="app-dialog-close"
          aria-label="Close dialog"
          @click="emit('close')"
        >
          Close
        </button>
      </header>
      <div class="app-dialog-body">
        <slot />
      </div>
      <footer v-if="$slots.footer" class="app-dialog-footer">
        <slot name="footer" />
      </footer>
    </div>
  </dialog>
</template>

<style scoped>
.app-dialog {
  border: none;
  padding: 0;
  background: transparent;
  color: var(--color-text);
  max-width: min(640px, calc(100vw - 24px));
  width: 100%;
  max-height: calc(var(--vv-height, 100dvh) - 24px);
}

.app-dialog::backdrop {
  background: color-mix(in oklch, var(--color-page), black 45%);
  opacity: 0.8;
}

.app-dialog-panel {
  display: flex;
  flex-direction: column;
  max-height: calc(var(--vv-height, 100dvh) - 24px);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 12px;
}

.app-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--color-border-subtle);
}

.app-dialog-title {
  font-size: 1.05rem;
  font-weight: 650;
  min-width: 0;
  overflow-wrap: anywhere;
}

.app-dialog-close {
  min-height: 44px;
  min-width: 44px;
  padding: 0 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: transparent;
  color: var(--color-text);
  cursor: pointer;
}

.app-dialog-body {
  padding: 16px;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.app-dialog-footer {
  padding: 12px 16px;
  border-top: 1px solid var(--color-border-subtle);
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

.app-dialog:focus-visible,
.app-dialog-close:focus-visible {
  outline: 3px solid var(--color-focus);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: no-preference) {
  .app-dialog[open] {
    animation: app-dialog-in 160ms ease-out;
  }
}

@keyframes app-dialog-in {
  from {
    opacity: 0;
  }
}

@media (max-width: 767px) {
  .app-dialog {
    position: fixed;
    top: calc(var(--vv-top, 0px) + 12px);
    left: 12px;
    right: 12px;
    margin: 0;
    width: auto;
    max-width: none;
    max-height: calc(var(--vv-height, 100dvh) - 24px);
  }

  .app-dialog-panel {
    max-height: calc(var(--vv-height, 100dvh) - 24px);
    overflow-y: auto;
  }
}
</style>
