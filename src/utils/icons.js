/**
 * 按需注册 Element Plus 图标
 * ------------------------------------------------------------------
 * 原实现通过 `import * as ElementPlusIconsVue` 全量注册图标库中的全部图标，
 * 会把整个图标包（293 个组件）打进首屏。这里改为显式列出项目真正用到的图标，
 * 既保留 `<component :is="'Monitor'" />` 这种字符串动态用法，又能显著减小产物体积。
 *
 * ⚠️ 新增图标时请同步写入下方 ICONS 列表。
 */
import {
  ArrowDown,
  Bell,
  ArrowRight,
  Box,
  Cellphone,
  Check,
  CircleCheck,
  CircleClose,
  Cloudy,
  Connection,
  DataBoard,
  CopyDocument,
  Cpu,
  Delete,
  Document,
  Download,
  Edit,
  Expand,
  Folder,
  Fold,
  Histogram,
  Key,
  Lightning,
  Link,
  Location,
  Lock,
  Monitor,
  MoreFilled,
  Odometer,
  Plus,
  Promotion,
  Refresh,
  Search,
  Setting,
  SetUp,
  SwitchButton,
  Timer,
  TrendCharts,
  Upload,
  User,
  UserFilled,
  VideoPause,
  VideoPlay,
  View,
  Warning,
  WarningFilled,
} from '@element-plus/icons-vue'

/** 项目实际使用的图标集合 */
export const ICONS = {
  ArrowDown,
  ArrowRight,
  Bell,
  Box,
  Cellphone,
  Check,
  CircleCheck,
  CircleClose,
  Cloudy,
  Connection,
  DataBoard,
  CopyDocument,
  Cpu,
  Delete,
  Document,
  Download,
  Edit,
  Expand,
  Folder,
  Fold,
  Histogram,
  Key,
  Lightning,
  Link,
  Location,
  Lock,
  Monitor,
  MoreFilled,
  Odometer,
  Plus,
  Promotion,
  Refresh,
  Search,
  Setting,
  SetUp,
  SwitchButton,
  Timer,
  TrendCharts,
  Upload,
  User,
  UserFilled,
  VideoPause,
  VideoPlay,
  View,
  Warning,
  WarningFilled,
}

/**
 * 别名兜底
 * 数据库中存量的 icon 字段可能包含图标库并不存在的名称（如种子数据里的 Flame），
 * 这里做一次映射，避免动态图标渲染为空。
 */
const ICON_ALIAS = {
  Flame: 'Warning',
  Fire: 'Warning',
  Alert: 'Bell',
  Device: 'Monitor',
  Sensor: 'Odometer',
}

/**
 * 注册图标到 Vue 应用实例
 * @param {import('vue').App} app
 */
export function registerIcons(app) {
  for (const [name, component] of Object.entries(ICONS)) {
    app.component(name, component)
  }
}

/**
 * 按名称解析图标组件，未命中时回退到 Box，避免动态图标渲染为空
 * @param {string} name
 */
export function resolveIcon(name) {
  if (ICONS[name]) return ICONS[name]
  const alias = ICON_ALIAS[name]
  return (alias && ICONS[alias]) || ICONS.Box
}
