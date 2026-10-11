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
  gap: 4px;
}

.app-nav-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  min-width: 44px;
  padding: 6px 12px;
  border-radius: 8px;
  color: var(--color-text-muted);
  text-decoration: none;
  font-size: 0.875rem;
}

.app-nav-link:hover {
  color: var(--color-text);
  background: var(--color-surface-raised);
}

.app-nav-link[aria-current='page'] {
  color: var(--color-text);
  font-weight: 650;
  box-shadow: inset 0 -3px 0 var(--color-primary);
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
    background: var(--color-surface);
    border-top: 1px solid var(--color-border-subtle);
  }

  .app-nav-link {
    flex-direction: column;
    justify-content: center;
    gap: 2px;
    min-width: 0;
    padding: 6px 2px;
    font-size: 0.75rem;
    text-align: center;
  }

  .app-nav-link[aria-current='page'] {
    box-shadow: inset 0 3px 0 var(--color-primary);
  }

  .app-nav-label {
    overflow-wrap: anywhere;
  }
}
</style>
