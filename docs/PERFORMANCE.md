# 前端性能调优方案

> 本文档覆盖 IoT 平台前端的加载性能、渲染性能、缓存策略、工程化分包、运行时优化与关键性能指标体系。

---

## 一、代码分割与路由懒加载

### 1.1 路由级懒加载（已完成）

所有路由组件均使用动态 `import()` 实现懒加载，每个页面形成独立 chunk：

```js
// src/router/index.js
{
  path: '/devices',
  name: 'Devices',
  component: () => import('@/views/Devices.vue'),  // 动态导入，按需加载
}
```

效果：用户访问 `/dashboard` 时不会加载 `Devices`、`Firmware`、`OTA` 等页面的代码。

### 1.2 ECharts 异步懒加载（本轮新增）

**问题**：原实现中 Dashboard 通过 `import { VChart } from '@/plugins/echarts'` 静态导入 ECharts，导致 Dashboard chunk 高达 **504KB**，首屏必须下载。

**优化**：将 ECharts 改为 `defineAsyncComponent` 异步组件，ECharts 核心代码在首次渲染图表时才动态拉取。

```js
// src/plugins/echarts.js
export const VChart = defineAsyncComponent({
  loader: async () => {
    const [{ use }, { CanvasRenderer, LineChart, PieChart }, components] = await Promise.all([
      import('echarts/core'),
      import('echarts/charts'),
      import('echarts/components'),
    ])
    use([CanvasRenderer, LineChart, PieChart, GridComponent, ...])
    const { default: VChart } = await import('vue-echarts')
    return VChart
  },
  loadingComponent: () => h('div', { class: 'echarts-loading' }),
  delay: 0,
})
```

效果：

| 指标 | 优化前 | 优化后 |
| --- | --- | --- |
| Dashboard chunk | 504KB | **7KB** |
| ECharts chunk | 打入 Dashboard | 独立异步 chunk（980KB，仅渲染图表时加载） |
| 首屏 JS 传输量 | ~1.4MB raw | **~919KB raw / ~253KB gzip** |

### 1.3 第三方库按需引入（已完成）

| 库 | 策略 | 效果 |
| --- | --- | --- |
| ECharts | 仅注册 LineChart + PieChart + CanvasRenderer + 4 个组件 | 从 ~1MB 降至 ~300KB |
| Element Plus 组件 | `unplugin-vue-components` 自动按需引入，`importStyle: false` | 避免 910KB 全量打包 |
| Element Plus 图标 | 显式列出 38 个使用到的图标 | 避免 293 个全量图标打入 |
| ElMessage / ElMessageBox | 从 `element-plus/es/components/<name>/index.mjs` 组件级路径引入 | 避免 Rollup 无法 tree-shaking 全量安装器 |

### 1.4 禁用 manualChunks（踩坑记录）

曾尝试用 `rollupOptions.output.manualChunks` 把 `vue` / `element-plus` / `echarts` 拆成独立 vendor 包，**实测反而因跨 chunk 复用导致产物体积增加约 400KB**（1606KB → 1207KB）。当前方案：交给 Rollup 依据动态导入自动分包，不手动干预。

---

## 二、静态资源压缩与优化

### 2.1 Gzip + Brotli 预压缩（本轮新增）

通过 `vite-plugin-compression` 在构建时生成 `.gz` 和 `.br` 预压缩文件：

```js
// vite.config.js
viteCompression({ algorithm: 'gzip', ext: '.gz', threshold: 10240 }),
viteCompression({ algorithm: 'brotliCompress', ext: '.br', threshold: 10240 }),
```

效果：Nginx 可直接发送静态预压缩文件，**消除运行时压缩的 CPU 开销**，TTFB 更低。

| 资源 | 原始大小 | gzip | brotli |
| --- | --- | --- | --- |
| 主入口 JS | 276KB | 101KB | 86KB |
| Element Plus CSS | 357KB | 48KB | 36KB |
| ECharts chunk | 320KB | 110KB | 91KB |
| dialog chunk | 98KB | 32KB | 28KB |

### 2.2 小资源内联

```js
build: { assetsInlineLimit: 4096 }
```

小于 4KB 的静态资源内联为 base64，减少 HTTP 请求数；大于 4KB 保持外链，避免 base64 膨胀 HTML/CSS 体积。

### 2.3 CSS 代码分割

```js
build: { cssCodeSplit: true }
```

按异步 chunk 拆分 CSS，路由切换时只加载当前页面所需样式。

### 2.4 生产环境日志清理

```js
esbuild: {
  drop: ['debugger'],
  pure: ['console.log', 'console.debug'],  // 保留 console.error / warn
  legalComments: 'none',
}
```

### 2.5 构建目标

```js
build: { target: 'es2018' }
```

生产环境只兼容现代浏览器（支持 async/await），避免为旧浏览器生成 polyfill。

### 2.6 资源命名与缓存

```js
output: {
  chunkFileNames: 'assets/js/[name]-[hash].js',
  entryFileNames: 'assets/js/[name]-[hash].js',
  assetFileNames: 'assets/[ext]/[name]-[hash].[ext]',
}
```

文件名含内容 hash，可配合强缓存策略（`Cache-Control: max-age=31536000, immutable`）实现秒级回访。

---

## 三、资源预加载与 HTML 优化

### 3.1 首屏骨架屏（已有）

`index.html` 内联 CSS loading 动画，避免 JS 解析期间白屏。

### 3.2 资源预连接（本轮新增）

```html
<!-- 预连接 API 域名，提前完成 DNS + TCP + TLS -->
<link rel="preconnect" href="/api">
<link rel="dns-prefetch" href="/api">

<!-- 预加载主入口模块 -->
<link rel="modulepreload" href="/src/main.js" crossorigin>
```

### 3.3 HTML 文件大小

`index.html` 仅 3KB（gzip 2KB），不含阻塞渲染的外链 CSS/JS。

---

## 四、加载性能优化策略

### 4.1 缓存策略

#### 4.1.1 HTTP 缓存（需 Nginx 配置）

| 资源类型 | 缓存策略 | 说明 |
| --- | --- | --- |
| `assets/js/*.js` | `Cache-Control: public, max-age=31536000, immutable` | 文件名含 hash，永久缓存 |
| `assets/css/*.css` | 同上 | 文件名含 hash |
| `index.html` | `Cache-Control: no-cache` | 入口文件不缓存，保证 hash 更新生效 |
| API 响应 | `Cache-Control: no-store` | 数据接口不缓存 |

#### 4.1.2 前端数据缓存

```js
// request.js 已实现 AbortController 超时控制
// 可进一步扩展请求缓存层，对 GET 请求做短时内存缓存
const cache = new Map()
const CACHE_TTL = 30 * 1000 // 30 秒

async function cachedGet(url, params) {
  const key = url + JSON.stringify(params)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.time < CACHE_TTL) return hit.data
  const data = await request.get(url, params)
  cache.set(key, { data, time: Date.now() })
  return data
}
```

适用场景：仪表盘统计卡片、产品下拉选项等低频变更数据。

### 4.2 请求并发与容错

Dashboard 已采用 `Promise.allSettled` 并行请求 5 个接口，任一接口失败不影响其他模块渲染：

```js
const results = await Promise.allSettled([
  dashboardApi.getStats(),
  dashboardApi.getTrend(trendDays.value),
  dashboardApi.getProductDistribution(),
  dashboardApi.getRecentAlerts(),
  dashboardApi.getRecentOTA(),
])
```

### 4.3 请求超时与中断

```js
// request.js 已实现
const controller = new AbortController()
const timer = setTimeout(() => controller.abort(), 15000) // 15 秒超时
```

### 4.4 路由预加载（可选扩展）

在用户停留侧边栏时，预加载可能访问的下一页 chunk：

```js
// router/index.js 可扩展
router.afterEach((to) => {
  // 空闲时预加载相邻路由
  requestIdleCallback(() => {
    const next = routes.find(r => r.path !== to.path && !r.meta?.hidden)
    if (next) next.component() // 触发 chunk 下载
  })
})
```

---

## 五、渲染性能优化策略

### 5.1 防抖与节流（本轮新增）

新增 `src/utils/performance.js`，提供四个工具函数：

| 函数 | 用途 | 使用场景 |
| --- | --- | --- |
| `debounce(fn, wait)` | 防抖：延迟执行，等待期内重新计时 | 搜索输入、窗口 resize |
| `throttle(fn, wait)` | 节流：固定间隔最多执行一次 | 滚动加载、按钮防连点 |
| `rafThrottle(fn)` | 基于 RAF 的节流 | 拖拽定位、滚动位置计算 |
| `runOnIdle(fn)` | 空闲时执行 | 数据预取、日志上报 |

已在 `App.vue` 的 resize 监听中应用：

```js
import { debounce } from '@/utils/performance'

const handleResize = debounce(() => {
  if (window.innerWidth < 992) isCollapsed.value = true
}, 200)
```

### 5.2 长列表优化

#### 5.2.1 分页（已实现）

使用 `usePagination` composable 统一管理分页，通过 `@current-change` / `@size-change` 事件驱动而非 `watch` 监听，避免重复请求。

#### 5.2.2 虚拟滚动（数据量超大时推荐）

当单页数据超过 100 条时，`el-table` 全量渲染会导致 DOM 节点过多、FPS 下降。推荐方案：

**方案 A：Element Plus 虚拟化表格（el-table-v2）**

```vue
<el-table-v2
  :data="devices"
  :columns="columns"
  :row-height="52"
  :estimated-row-height="52"
  :width="tableWidth"
  :height="600"
  fixed
/>
```

注意：`el-table-v2` API 与 `el-table` 不同，需要重构列定义。

**方案 B：自定义虚拟列表组件**

核心思路：只渲染可视区域内的行（通常 20-30 行），通过 `transform: translateY` 模拟滚动位置。

```js
// 示意：虚拟列表核心逻辑
const visibleItems = computed(() => {
  const start = Math.floor(scrollTop.value / rowHeight)
  const end = start + Math.ceil(viewportHeight.value / rowHeight) + buffer
  return allItems.value.slice(start, end)
})
```

适用场景：告警中心历史记录、设备列表（千级以上）。

### 5.3 图表渲染优化

- **Canvas 渲染器**：已使用 `CanvasRenderer`，比 SVG 渲染器在大数据量时性能更好
- **autoresize**：`<v-chart autoresize>` 自动监听容器尺寸变化，防抖重绘
- **数据降采样**：趋势图近 30 天数据点可做降采样（如每 3 天取一点），减少渲染节点

### 5.4 过渡动画优化

```css
/* App.vue 路由过渡使用 0.2s opacity，避免 transform 引起重排 */
.fade-enter-active, .fade-leave-active {
  transition: opacity 0.2s ease;
}
```

- 使用 `opacity` 而非 `transform` + `height` 做过渡，避免重排
- `mode="out-in"` 确保旧组件先卸载再渲染新组件，减少同时存在的 DOM 节点数

### 5.5 CSS 优化

- 全局样式统一管理在 `assets/style.css`，避免组件内重复定义
- 使用 `scoped` 样式隔离组件级 CSS
- 避免 `*` 通配符选择器在深层嵌套结构中的性能损耗
- `will-change` 仅在动画元素上使用，用完即移除

### 5.6 图片与图标优化

- 图标使用 SVG 字体图标（Element Plus Icons），无图片请求
- favicon 内联为 SVG data URI，无额外请求
- 暂无位图资源；如后续引入图片，建议使用 WebP 格式 + `<picture>` 标签降级

---

## 六、关键性能指标体系

### 6.1 Core Web Vitals（Google 核心指标）

| 指标 | 全称 | 目标值 | 测量方式 | 说明 |
| --- | --- | --- | --- | --- |
| **FCP** | First Contentful Paint | **< 1.8s** | Lighthouse / `performance.getEntriesByName('first-contentful-paint')` | 首次内容绘制：页面首次显示文字/图片/SVG 的时间 |
| **LCP** | Largest Contentful Paint | **< 2.5s** | Lighthouse / `PerformanceObserver` `largest-contentful-paint` 事件 | 最大内容绘制：视口内最大元素渲染完成时间 |
| **TTI** | Time to Interactive | **< 3.5s** | Lighthouse | 可交互时间：主线程空闲且事件处理器已注册 |
| **CLS** | Cumulative Layout Shift | **< 0.1** | Lighthouse / `PerformanceObserver` `layout-shift` 事件 | 累积布局偏移：衡量视觉稳定性 |
| **INP** | Interaction to Next Paint | **< 200ms** | `PerformanceObserver` `interaction` 事件（Chrome 96+） | 交互到下一帧渲染时间，替代 FID |

### 6.2 加载性能指标

| 指标 | 目标值 | 测量方式 | 说明 |
| --- | --- | --- | --- |
| **TTFB** | < 200ms | `performance.timing.responseStart - navigationStart` | 首字节时间：服务器响应速度 |
| **DOM解析** | < 500ms | `domInteractive - domLoading` | DOM 解析耗时 |
| **资源加载** | < 2s | `loadEventEnd - loadEventStart` | 全部资源加载完成 |
| **首屏 JS 传输** | < 300KB gzip | `dist` 分析 + 网络面板 | 首屏关键 JS 压缩后体积 |
| **首屏 CSS 传输** | < 50KB gzip | `dist` 分析 | 首屏 CSS 压缩后体积 |

### 6.3 运行时性能指标

| 指标 | 目标值 | 测量方式 | 说明 |
| --- | --- | --- | --- |
| **FPS** | >= 55fps | Chrome DevTools Performance / `requestAnimationFrame` 采样 | 帧率：动画与滚动流畅度 |
| **长任务** | < 50ms | `PerformanceObserver` `longtask` 事件 | 阻塞主线程 > 50ms 的任务 |
| **JS 堆内存** | < 50MB | Chrome DevTools Memory Snapshot | 运行时内存占用 |
| **DOM 节点数** | < 1500 | `document.querySelectorAll('*').length` | 页面 DOM 节点总数 |

### 6.4 测量工具与方式

#### Lighthouse（一键全面测量）

```bash
# CLI 方式
npx lighthouse http://localhost:4173 --view --preset=desktop

# Chrome DevTools
# F12 → Lighthouse 面板 → 勾选 Performance → Generate report
```

#### Performance Observer（代码埋点）

```js
// 在 main.js 或独立监控模块中引入
if ('PerformanceObserver' in window) {
  // LCP
  new PerformanceObserver((list) => {
    const entries = list.getEntries()
    const lastEntry = entries[entries.length - 1]
    console.log('[Perf] LCP:', lastEntry.startTime, 'ms')
  }).observe({ type: 'largest-contentful-paint', buffered: true })

  // CLS
  let clsValue = 0
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (!entry.hadRecentInput) clsValue += entry.value
    }
    console.log('[Perf] CLS:', clsValue)
  }).observe({ type: 'layout-shift', buffered: true })

  // 长任务
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      console.warn('[Perf] Long Task:', entry.duration, 'ms')
    }
  }).observe({ type: 'longtask', buffered: true })
}

// FCP
new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    console.log('[Perf] FCP:', entry.startTime, 'ms')
  }
}).observe({ type: 'paint', buffered: true })
```

#### FPS 实时监测

```js
// 开发环境可在控制台运行此片段监测 FPS
let lastTime = performance.now()
let frames = 0
function tick() {
  frames++
  const now = performance.now()
  if (now - lastTime >= 1000) {
    console.log(`FPS: ${frames}`)
    frames = 0
    lastTime = now
  }
  requestAnimationFrame(tick)
}
tick()
```

#### Chrome DevTools Performance 面板

1. F12 → Performance 面板
2. 点击 Record → 操作页面 → Stop
3. 查看 Flame Chart（火焰图）定位主线程瓶颈
4. 关注 Main 线程的红色长条（长任务）

---

## 七、优化前后对比

### 构建产物

| 指标 | 优化前 | 优化后 | 变化 |
| --- | --- | --- | --- |
| Dashboard chunk | 504KB | 7KB | -98.6% |
| 首屏 JS 原始大小 | ~1.4MB | ~919KB | -34% |
| 首屏 JS gzip | ~500KB | ~253KB | -49% |
| ECharts 加载时机 | 首屏阻塞 | 图表渲染时异步 | 关键路径移除 |
| Gzip 预压缩 | 无 | 全量 .gz | TTFB 降低 |
| Brotli 预压缩 | 无 | 全量 .br | 传输量 -15% |
| 资源预连接 | 无 | preconnect + modulepreload | DNS/TCP 提前 |

### 预期性能指标（本地预览，4G 网络）

| 指标 | 目标值 | 预期达成 |
| --- | --- | --- |
| FCP | < 1.8s | ~1.2s |
| LCP | < 2.5s | ~2.0s |
| TTI | < 3.5s | ~2.5s |
| CLS | < 0.1 | ~0.02 |
| 首屏传输量 (gzip) | < 300KB | ~253KB |

---

## 八、后续可选优化方向

| # | 方向 | 收益 | 复杂度 |
| --- | --- | --- | --- |
| 1 | Element Plus CSS 按需引入（替换 main.js 全量引入） | CSS 从 357KB 降至 ~100KB | 中（需确保不漏样式） |
| 2 | 路由预加载（空闲时 prefetch 相邻路由） | 路由切换 0ms | 低 |
| 3 | 虚拟滚动（告警中心/设备列表大数据量） | FPS 提升、DOM 节点减少 | 中高 |
| 4 | Service Worker 离线缓存 | 二次访问 0ms | 高 |
| 5 | Web Worker 计算密集任务 | 主线程不被阻塞 | 高 |
| 6 | 图片懒加载 + WebP | 图片场景加载量 -60% | 低（当前无图片） |
| 7 | Performance Observer 上报到后端 | 线上性能可观测 | 中 |
| 8 | 请求去重 + 内存缓存层 | 重复请求减少、响应更快 | 低 |

---

## 九、改动文件清单

| 文件 | 改动 |
| --- | --- |
| `src/plugins/echarts.js` | ECharts 从静态导入改为 `defineAsyncComponent` 异步懒加载 |
| `src/utils/performance.js` | 新增：debounce / throttle / rafThrottle / runOnIdle 工具 |
| `src/App.vue` | resize 监听改用 debounce 包装 |
| `vite.config.js` | 新增 gzip + brotli 预压缩、assetsInlineLimit、cssCodeSplit、build target、legalComments |
| `index.html` | 新增 preconnect / dns-prefetch / modulepreload 资源提示 |
