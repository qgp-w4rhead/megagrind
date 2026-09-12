<script setup lang="ts">
import { Timer, LayoutDashboard, Calendar, Settings } from 'lucide-vue-next'
</script>

<template>
  <nav class="app-nav">
    <RouterLink to="/" class="nav-link">
      <Timer :size="16" /> Track
    </RouterLink>
    <RouterLink to="/dashboard" class="nav-link">
      <LayoutDashboard :size="16" /> Dashboard
    </RouterLink>
    <RouterLink to="/history" class="nav-link">
      <Calendar :size="16" /> History
    </RouterLink>
    <RouterLink to="/settings" class="nav-link">
      <Settings :size="16" /> Settings
    </RouterLink>
  </nav>
</template>

<style scoped>
.app-nav {
  display: flex;
  gap: 4px;
}

.nav-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 8px;
  color: var(--text-muted, #888);
  text-decoration: none;
  font-size: 0.8rem;
  transition:
    color 0.15s ease,
    background 0.15s ease;
}

.nav-link:hover {
  color: var(--text-primary, #e2e8f0);
  background: var(--surface-2, rgba(255, 255, 255, 0.06));
}

.nav-link.router-link-active {
  color: var(--accent-purple, #a78bfa);
  background: var(--surface-2, rgba(255, 255, 255, 0.06));
}
</style>
