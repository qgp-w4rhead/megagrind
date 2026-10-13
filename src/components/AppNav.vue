<script setup lang="ts">
import { Timer, LayoutDashboard, Calendar, Settings } from 'lucide-vue-next'

const destinations = [
  { to: '/', label: 'Today', icon: Timer },
  { to: '/dashboard', label: 'Insights', icon: LayoutDashboard },
  { to: '/history', label: 'History', icon: Calendar },
  { to: '/settings', label: 'Settings', icon: Settings },
]
</script>

<template>
  <nav class="app-nav" aria-label="Primary">
    <RouterLink v-for="item in destinations" :key="item.to" :to="item.to" class="app-nav-link">
      <component :is="item.icon" :size="20" aria-hidden="true" class="app-nav-icon" />
      <span class="app-nav-label">{{ item.label }}</span>
    </RouterLink>
  </nav>
</template>

<style scoped>
.app-nav {
  display: flex;
  gap: 2px;
}

.app-nav-link {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 44px;
  min-width: 44px;
  padding: 6px 13px;
  border-radius: var(--radius-control);
  color: var(--color-text-muted);
  text-decoration: none;
  font-size: 0.875rem;
  transition: color 120ms ease, background 120ms ease;
}

.app-nav-link:hover {
  color: var(--color-text);
  background: var(--color-surface-raised);
}

.app-nav-link[aria-current='page'] {
  color: var(--color-primary);
  font-weight: 650;
}

.app-nav-link[aria-current='page']::after {
  content: '';
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 2px;
  height: 2px;
  border-radius: 1px;
  background: var(--color-primary);
  box-shadow: 0 0 8px color-mix(in oklch, var(--color-primary), transparent 40%);
}

@media (max-width: 767px) {
  .app-nav {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 50;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0;
    padding: 4px 4px calc(4px + env(safe-area-inset-bottom));
    background: var(--surface-sheen);
    border-top: 1px solid var(--hairline);
    box-shadow: 0 -12px 28px -18px rgb(0 0 0 / 0.6);
  }

  .app-nav-link {
    flex-direction: column;
    justify-content: center;
    gap: 3px;
    min-width: 0;
    padding: 7px 2px;
    font-size: 0.6875rem;
    text-align: center;
    border-radius: 8px;
  }

  .app-nav-link[aria-current='page']::after {
    left: 50%;
    right: auto;
    top: 1px;
    bottom: auto;
    width: 22px;
    transform: translateX(-50%);
  }

  .app-nav-label {
    overflow-wrap: anywhere;
    letter-spacing: 0.02em;
  }
}
</style>
