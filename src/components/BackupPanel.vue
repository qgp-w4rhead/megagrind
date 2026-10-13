<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import { useMegagrindStore } from '../stores/megagrind'
import { makeDownload } from '../stores/persistencePlugin'
import type { FullBackupV2, ImportPreview } from '../domain/backup'
import { formatDuration } from '../domain/today'

const store = useMegagrindStore()
const fileInput = ref<HTMLInputElement | null>(null)
const backup = ref<FullBackupV2 | null>(null)
const preview = ref<ImportPreview | null>(null)
const importError = ref('')
const importDone = ref('')
const replaceMode = ref(false)
const restorePreferences = ref(false)
const replaceConfirmed = ref(false)
const conflictChoices = ref<Record<string, 'local' | 'imported'>>({})
const openChoice = ref('')
const closeTimes = ref<Record<string, string>>({})
const reportStart = ref('')
const reportEnd = ref('')
const uid = useId()
const fileId = `${uid}-backup-file`
const reportStartId = `${uid}-report-start`
const reportEndId = `${uid}-report-end`
const prefsId = `${uid}-restore-preferences`
const replaceId = `${uid}-replace-mode`

const conflictEntries = computed(() => {
  if (!preview.value) return []
  const local = new Map(store.entries.map((e) => [e.id, e]))
  const incoming = new Map(preview.value.document.entries.map((e) => [e.id, e]))
  return preview.value.conflicts.map((id) => ({ id, local: local.get(id)!, imported: incoming.get(id)! }))
})

const openEntries = computed(() => {
  if (!preview.value) return []
  const all = new Map([...store.entries, ...preview.value.document.entries].map((e) => [e.id, e]))
  return preview.value.multipleOpenIds.map((id) => all.get(id)!).filter(Boolean)
})

const canApply = computed(() => {
  if (!preview.value) return false
  if (replaceMode.value && !replaceConfirmed.value) return false
  if (preview.value.conflicts.some((id) => conflictChoices.value[id] !== 'local' && conflictChoices.value[id] !== 'imported')) return false
  if (preview.value.multipleOpenIds.length > 1) {
    if (!openChoice.value) return false
    return preview.value.multipleOpenIds.every((id) => id === openChoice.value || (closeTimes.value[id] ?? '').length > 0)
  }
  return true
})

function downloadText(filename: string, data: unknown) {
  makeDownload(filename, JSON.stringify(data, null, 2))
}

function exportFull() {
  downloadText(`megagrind-full-backup-${new Date().toISOString().slice(0, 10)}.json`, store.exportFullBackup())
}

function exportReport() {
  const start = Date.parse(reportStart.value)
  const end = Date.parse(reportEnd.value)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    importError.value = 'Choose a valid report start and end first.'
    return
  }
  downloadText(`megagrind-period-report-${new Date(start).toISOString().slice(0, 10)}.json`, store.exportPeriodReport({ start, end }))
}

function pickFile() {
  fileInput.value?.click()
}

async function readFile(file: File) {
  importError.value = ''
  importDone.value = ''
  backup.value = null
  preview.value = null
  try {
    const text = await file.text()
    const parsed = store.parseBackupText(text)
    backup.value = parsed
    preview.value = store.previewBackupImport(parsed, replaceMode.value ? 'replace' : 'merge')
    conflictChoices.value = {}
    openChoice.value = ''
    closeTimes.value = {}
  } catch (err) {
    importError.value = err instanceof Error ? err.message : 'The selected file could not be restored.'
  }
}

function refreshPreview() {
  if (!backup.value) return
  preview.value = store.previewBackupImport(backup.value, replaceMode.value ? 'replace' : 'merge')
}

function apply() {
  if (!backup.value || !preview.value) return
  try {
    const close: Record<string, number> = {}
    for (const id of preview.value.multipleOpenIds) {
      if (id === openChoice.value) continue
      const stamp = Date.parse(closeTimes.value[id] ?? '')
      if (!Number.isFinite(stamp)) throw new Error('Enter a finish time for every extra running activity.')
      close[id] = stamp
    }
    const result = store.applyBackupImport(backup.value, {
      mode: replaceMode.value ? 'replace' : 'merge',
      conflictChoices: conflictChoices.value,
      restorePreferences: restorePreferences.value,
      openChoice: preview.value.multipleOpenIds.length > 1 ? { keepEntryId: openChoice.value, close } : undefined,
    })
    if (result.kind === 'blocked') {
      importError.value = result.reason
      return
    }
    importDone.value = store.saveSucceeded(`Restore finished: ${result.changedIds.length} record(s) changed`)
    backup.value = null
    preview.value = null
  } catch (err) {
    importError.value = err instanceof Error ? err.message : 'Restore failed before changing your records.'
  }
}
</script>

<template>
  <div class="backup-panel">
    <p class="backup-copy">
      Full backups contain every time record, progress event, and portable preference. Device URL, theme, browser permission, and queued server work stay on this device.
    </p>
    <div class="backup-actions">
      <button type="button" class="btn-action" data-test="export-full" @click="exportFull">Export full backup</button>
    </div>
    <div class="report-export">
      <h4>Period report</h4>
      <p class="backup-copy">A report is a read-only interval file for review; it cannot be restored as a backup.</p>
      <div class="report-grid">
        <div class="field">
          <label :for="reportStartId">Start</label>
          <input :id="reportStartId" v-model="reportStart" type="datetime-local" data-test="report-start" />
        </div>
        <div class="field">
          <label :for="reportEndId">End</label>
          <input :id="reportEndId" v-model="reportEnd" type="datetime-local" data-test="report-end" />
        </div>
      </div>
      <button type="button" class="btn-action" data-test="export-report" @click="exportReport">Export period report</button>
    </div>

    <div class="restore-box">
      <h4>Restore backup</h4>
      <input :id="fileId" ref="fileInput" class="sr-only" type="file" accept="application/json,.json" data-test="backup-file" @change="(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) void readFile(f) }" />
      <label :for="fileId" class="field-label">Backup file</label>
      <button type="button" class="btn-action" data-test="pick-backup" @click="pickFile">Choose file</button>
      <p v-if="importError" class="import-error" role="alert" data-test="import-error">{{ importError }}</p>
      <p v-if="importDone" class="import-done" role="status" data-test="import-done">{{ importDone }}</p>

      <div v-if="preview" class="preview" data-test="import-preview">
        <h5>Preview</h5>
        <dl class="preview-counts">
          <div><dt>Additions</dt><dd>{{ preview.added.length }}</dd></div>
          <div><dt>Unchanged</dt><dd>{{ preview.identical.length }}</dd></div>
          <div><dt>Conflicts</dt><dd>{{ preview.conflicts.length }}</dd></div>
          <div><dt>Removals</dt><dd>{{ preview.removed.length }}</dd></div>
        </dl>
        <ul v-if="preview.warnings.length" class="warning-list">
          <li v-for="warning in preview.warnings" :key="warning">{{ warning }}</li>
        </ul>

        <label class="check-row" :for="replaceId">
          <input :id="replaceId" v-model="replaceMode" type="checkbox" data-test="replace-mode" @change="refreshPreview" />
          <span>Replace local records instead of merging</span>
        </label>
        <p v-if="replaceMode" class="warning-list">
          This will remove {{ preview.removed.length }} local record(s) not present in the file.
          When sync is on, removed records are also deleted on the server and queued changes
          for replaced records are superseded.
        </p>
        <label v-if="replaceMode" class="check-row">
          <input v-model="replaceConfirmed" type="checkbox" data-test="replace-confirm" />
          <span>I saved a recovery copy and approve removing the listed local records.</span>
        </label>
        <label class="check-row" :for="prefsId">
          <input :id="prefsId" v-model="restorePreferences" type="checkbox" data-test="restore-preferences" />
          <span>Restore portable preferences (never endpoint URL, sync mode, theme, or alerts)</span>
        </label>

        <div v-if="conflictEntries.length" class="conflict-list">
          <h5>Changed records need a choice</h5>
          <div v-for="pair in conflictEntries" :key="pair.id" class="conflict-card">
            <p><strong>{{ pair.id }}</strong></p>
            <p>Local: {{ pair.local.type }} {{ formatDuration((pair.local.end ?? store.now) - pair.local.start) }}</p>
            <p>File: {{ pair.imported.type }} {{ formatDuration((pair.imported.end ?? store.now) - pair.imported.start) }}</p>
            <label><input v-model="conflictChoices[pair.id]" type="radio" value="local" :name="`${uid}-${pair.id}`" /> Keep local</label>
            <label><input v-model="conflictChoices[pair.id]" type="radio" value="imported" :name="`${uid}-${pair.id}`" /> Use file</label>
          </div>
        </div>

        <div v-if="openEntries.length" class="conflict-list">
          <h5>Only one activity can stay running</h5>
          <div v-for="entry in openEntries" :key="entry.id" class="conflict-card">
            <label><input v-model="openChoice" type="radio" :value="entry.id" :name="`${uid}-open`" /> Keep {{ entry.type }} running</label>
            <div v-if="openChoice !== entry.id" class="field">
              <label :for="`${uid}-close-${entry.id}`">Finish {{ entry.type }} at</label>
              <input :id="`${uid}-close-${entry.id}`" v-model="closeTimes[entry.id]" type="datetime-local" />
            </div>
          </div>
        </div>

        <button type="button" class="btn-primary" :disabled="!canApply" data-test="apply-import" @click="apply">Apply restore</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.backup-panel,
.restore-box,
.report-export {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.backup-copy,
.import-error,
.import-done {
  color: var(--color-text-muted);
  font-size: 0.9375rem;
  line-height: 1.5;
}

.import-error {
  color: var(--color-danger-text);
}

.import-done {
  color: var(--color-primary);
}

.backup-actions,
.report-grid,
.preview-counts {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.report-export > h4,
.restore-box > h4 {
  font-size: 0.8125rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: min(100%, 220px);
}

.field label,
.field-label {
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.field input {
  min-height: 44px;
  padding: 8px 10px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-control);
  background: var(--control-bg);
  color: var(--color-text);
  font: inherit;
  font-size: 0.9375rem;
}

.field input:focus {
  outline: none;
  border-color: var(--color-primary);
}

.field input:focus-visible {
  outline: 3px solid var(--color-focus);
  outline-offset: 1px;
}

.field-label,
h4,
h5 {
  font-weight: 650;
}

h5 {
  font-size: 0.8125rem;
}

.check-row {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  font-size: 0.9375rem;
}

.check-row input {
  width: 20px;
  height: 20px;
  accent-color: var(--color-primary);
  flex-shrink: 0;
}

.preview,
.conflict-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-control);
  background: var(--control-bg);
}

.conflict-card p {
  font-size: 0.875rem;
  line-height: 1.45;
}

.conflict-card label {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  font-size: 0.9375rem;
}

.conflict-card input[type='radio'] {
  accent-color: var(--color-primary);
}

.preview-counts {
  gap: 0;
  border-top: 1px solid var(--hairline);
}

.preview-counts > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 16px 4px 0;
  margin-right: 16px;
  border-right: 1px solid var(--hairline);
}

.preview-counts > div:last-child {
  border-right: none;
}

.preview-counts dt {
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.preview-counts dd {
  font-family: var(--font-mono);
  font-size: 1.125rem;
  font-variant-numeric: tabular-nums;
  color: var(--color-text);
}

.warning-list {
  color: var(--color-danger-text);
  font-size: 0.875rem;
  line-height: 1.5;
  margin: 0;
  padding-left: 18px;
}
</style>
