/**
 * pi-company site — 入口文件
 */
import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { installRuntimeI18n } from './i18n/runtime'
import './assets/styles/main.css'

const app = createApp(App)
app.use(router)
app.mount('#app')
installRuntimeI18n()
