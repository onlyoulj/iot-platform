/**
 * ECharts 异步懒加载导出
 * ------------------------------------------------------------------
 * 优化策略：
 * 1. 只注册项目真正用到的图表与组件（echarts-setup.js 中静态 import），
 *    配合 Canvas 渲染器大幅减小体积（从 ~1MB 降至 ~300KB）。
 * 2. 将 echarts 核心代码从 Dashboard chunk 中分离为独立异步 chunk：
 *    本文件被 Dashboard/ApiStats 静态 import（自身极轻，仅 defineAsyncComponent），
 *    内部 `await import('./echarts-setup.js')` 让 ECharts 核心代码
 *    在首次渲染图表时才动态拉取，首屏不加载 ECharts（约 400KB+）。
 *
 * 为什么用「动态 import setup 文件」而非「动态 import echarts 各模块」：
 *   Vite 预构建对 `echarts/components` 聚合入口的动态 import 不可靠，
 *   命名导出可能变成 undefined。拆成 setup 文件用静态 import，
 *   Vite 能正确分析 ESM 导出，同时仍保持异步 chunk 分包。
 *
 * 用法不变：`import { VChart } from '@/plugins/echarts'`
 */
import { defineAsyncComponent, h } from 'vue'

/**
 * 异步 VChart 组件。
 * - 首次渲染时自动加载 echarts-setup chunk 并完成注册；
 * - 加载期间显示空白占位，避免 layout shift；
 * - 加载失败时静默（图表区域为空，不影响页面其他模块）。
 *
 * 用法与同步组件完全一致：
 *   <v-chart class="chart" :option="option" autoresize />
 */
export const VChart = defineAsyncComponent({
  loader: async () => {
    try {
      const { default: VChart } = await import('./echarts-setup.js')
      return VChart
    } catch (err) {
      console.error('[ECharts] 动态加载失败', err)
      // 返回空渲染组件，防止整页白屏
      return () => h('div', { class: 'echarts-load-failed' })
    }
  },
  loadingComponent: () => h('div', { class: 'echarts-loading' }),
  delay: 0,
  timeout: 15000,
  errorComponent: () => h('div', { class: 'echarts-load-failed' }),
})

export default VChart
