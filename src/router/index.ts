import { createRouter, createWebHistory } from 'vue-router'
import TrackView from '../views/TrackView.vue'
import Dashboard from '../components/Dashboard.vue'
import HistoryView from '../components/HistoryView.vue'
import SettingsPanel from '../components/SettingsPanel.vue'

export const routes = [
  { path: '/', name: 'track', component: TrackView },
  { path: '/dashboard', name: 'dashboard', component: Dashboard },
  { path: '/history', name: 'history', component: HistoryView },
  { path: '/settings', name: 'settings', component: SettingsPanel },
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})

export default router
