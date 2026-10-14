import { createApp } from 'vue'

// Element Plus 采用「组件按需自动引入」方案（见 vite.config.js 的 Components 插件），
// 因此这里不再 app.use(ElementPlus) 全量注册组件；
// 样式统一引入完整 CSS，保证按需组件与指令的样式不缺漏。
import 'element-plus/dist/index.css'

import App from './App.vue'
import router from './router'
import { registerIcons } from './utils/icons'
import { setUnauthorizedHandler } from './utils/request'
import { clearSession } from './utils/auth'
import { markProfileStale } from './router'
import './assets/style.css'

const app = createApp(App)

// 按需注册图标（替代原来的全量注册）
registerIcons(app)

// 任意接口返回 401 时：清理本地会话并跳转登录页（带 redirect 便于登录后回到原页）
setUnauthorizedHandler(() => {
  clearSession()
  markProfileStale()
  const current = router.currentRoute.value
  if (current.name === 'Login') return
  router.replace({ path: '/login', query: { redirect: current.fullPath } })
})

app.use(router)

// 全局错误兜底，避免未捕获异常导致页面白屏且无迹可循
app.config.errorHandler = (err, instance, info) => {
  console.error('[Global Error]', info, err)
}

app.mount('#app')
