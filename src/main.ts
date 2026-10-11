import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { megagrindPersistencePlugin } from './stores/persistencePlugin'

import App from './App.vue'
import router from './router'
import './styles/theme.css'

const app = createApp(App)
const pinia = createPinia()

pinia.use(megagrindPersistencePlugin)

app.use(pinia)
app.use(router)

app.mount('#app')
