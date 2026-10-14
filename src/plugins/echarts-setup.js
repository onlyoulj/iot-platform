/**
 * ECharts 注册模块（静态 import，被打入独立异步 chunk）
 * ------------------------------------------------------------------
 * 用静态 import 而非动态 import，原因：
 *  1. Vite 预构建对 `echarts/components` 聚合入口的动态 import 不可靠，
 *     命名导出可能变成 undefined，导致 use() 报 "Cannot read properties of
 *     undefined (reading 'install')"；
 *  2. 静态 import 让 Vite 正确分析 ESM 导出，tree-shaking 正常工作；
 *  3. 本文件被 echarts.js 以 `await import('./echarts-setup.js')` 动态加载，
 *     因此 ECharts 核心代码仍形成独立异步 chunk，首屏不加载。
 *
 * 新增图表类型时，在此文件补充 import 与 use()。
 */
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { LineChart, PieChart, BarChart } from 'echarts/charts'
import {
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
  DataZoomComponent,
} from 'echarts/components'
import VChart from 'vue-echarts'

use([
  CanvasRenderer,
  LineChart,
  PieChart,
  BarChart,
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
  DataZoomComponent,
])

export default VChart
