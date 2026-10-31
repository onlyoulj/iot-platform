import './styles/global.css'
import './styles/animations.css'
import App from './App.vue'
import { createSSRApp } from 'vue'

export function createApp() {
  const app = createSSRApp(App)
  return {
    app,
  }
}
