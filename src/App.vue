<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { useMegagrindStore } from './stores/megagrind'
import AppNav from './components/AppNav.vue'

const store = useMegagrindStore()
store.migrateSettings()

onMounted(() => {
  store.resetStaleProgressCheck()
  updateTheme()
  // Load remote entries/settings when a backend is configured.
  // Returns early in local mode. Errors are logged inside.
  store.initFromBackend()
})

function updateTheme() {
  const mode = store.settings.darkMode
  let theme = 'dark'
  if (mode === 'auto') {
    theme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  } else {
    theme = mode
  }
  document.body.classList.remove('dark', 'light')
  document.body.classList.add(theme)
}

watch(() => store.settings.darkMode, updateTheme)
</script>

<template>
  <div class="app">
    <header class="header">
      <div class="header-left">
        <h1 class="title">MEGAGRIND</h1>
        <span class="subtitle">Work more than Bill Gates</span>
      </div>
      <AppNav />
    </header>

    <main class="main">
      <router-view />
    </main>
  </div>
</template>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  padding-top: env(safe-area-inset-top);
  padding-bottom: env(safe-area-inset-bottom);
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
  line-height: 1.5;
  scroll-behavior: smooth;
  -webkit-tap-highlight-color: transparent;
}

::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

body.dark {
  --bg-primary: #0f0f1a;
  --bg-secondary: #1a1a2e;
  --bg-tertiary: #2a2a4e;
  --bg-hover: #3a3a6e;
  --text-primary: #e2e8f0;
  --text-secondary: #94a3b8;
  --text-muted: #64748b;
  --border-color: #2a2a4e;
  --accent-purple: #a78bfa;
  --accent-purple-hover: #8b5cf6;
  --accent-green: #4ade80;
  --accent-red: #f87171;
  --accent-yellow: #fbbf24;
  --accent-cyan: #38bdf8;
  --accent-cyan-hover: #0ea5e9;
}

body.light {
  --bg-primary: #f8fafc;
  --bg-secondary: #ffffff;
  --bg-tertiary: #e2e8f0;
  --bg-hover: #f1f5f9;
  --text-primary: #1e293b;
  --text-secondary: #475569;
  --text-muted: #64748b;
  --border-color: #e2e8f0;
  --accent-purple: #8b5cf6;
  --accent-purple-hover: #7c3aed;
  --accent-green: #22c55e;
  --accent-red: #ef4444;
  --accent-yellow: #eab308;
  --accent-cyan: #0ea5e9;
  --accent-cyan-hover: #0284c7;
}

body {
  background: var(--bg-primary);
  color: var(--text-primary);
}

::-webkit-scrollbar-track {
  background: var(--bg-secondary);
}

::-webkit-scrollbar-thumb {
  background: var(--bg-tertiary);
  border-radius: 5px;
}

::-webkit-scrollbar-thumb:hover {
  background: var(--accent-purple);
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.5rem 2rem;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
}

.header-left {
  display: flex;
  flex-direction: column;
}

.title {
  font-size: 1.5rem;
  font-weight: 800;
  color: var(--accent-purple);
  letter-spacing: -0.02em;
  margin: 0;
}

.subtitle {
  font-size: 0.75rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 1rem;
  justify-content: space-between;
}

.header-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: nowrap;
}

.work-summary {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
}

.summary-label {
  color: var(--text-muted);
}

.summary-value {
  font-weight: 700;
  color: var(--accent-green);
  font-variant-numeric: tabular-nums;
}

.summary-divider {
  color: var(--text-muted);
}

.summary-remaining {
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.5rem;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  color: var(--text-primary);
  cursor: pointer;
  transition: all 0.2s ease;
}

.icon-btn:hover {
  background: var(--bg-hover);
}

.btn-icon {
  width: 20px;
  height: 20px;
}

.main {
  flex: 1;
  padding: 2rem;
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.desktop-only {
  display: none !important;
}

@media (min-width: 769px) {
  .desktop-only {
    display: grid !important;
  }
}

.trackers-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 1.5rem;
}

.work-idle-row {
  display: flex;
  gap: 2rem;
  align-items: stretch;
  min-height: 250px;
}

.work-section,
.chores-section,
.idle-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  position: relative;
}



.work-section > *,
.chores-section > *,
.idle-section > * {
  flex: 1;
}

@media (max-width: 768px) {
  .header {
    flex-direction: column;
    align-items: flex-start;
    gap: 1rem;
    padding: 1rem;
    padding-top: calc(1rem + env(safe-area-inset-top));
  }

  .header-right {
    width: 100%;
    justify-content: space-between;
    align-items: center;
    gap: 0.75rem;
  }

  .header-actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: nowrap;
  }

  .work-summary {
    font-size: 0.75rem;
    flex-wrap: wrap;
  }

  .main {
    padding: 1rem;
    padding-bottom: calc(1rem + env(safe-area-inset-bottom));
  }

  .trackers-grid {
    grid-template-columns: 1fr;
    gap: 1rem;
  }

  .work-idle-row {
    flex-direction: column;
    gap: 1rem;
  }

  .work-section,
  .chores-section,
  .idle-section {
    min-height: auto;
  }

  

  .work-section:not(:last-child),
  .chores-section:not(:last-child) {
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--border-color);
  }
}

@media (max-width: 480px) {
  .title {
    font-size: 1.25rem;
  }

  .subtitle {
    font-size: 0.625rem;
  }

  .work-summary {
    font-size: 0.6875rem;
    gap: 0.375rem;
    flex: 1;
    min-width: 0;
  }

  .summary-value {
    font-size: 0.8125rem;
  }

  .main {
    padding: 0.75rem;
    gap: 1rem;
  }

  .trackers-grid {
    gap: 0.75rem;
  }
}
</style>
