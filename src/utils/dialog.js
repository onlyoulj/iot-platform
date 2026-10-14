/**
 * 统一确认 / 提示弹窗
 * ------------------------------------------------------------------
 * 1. 复用统一的按钮文案与样式，避免每个调用点重复书写；
 * 2. 不依赖 Element Plus 的全局 locale 配置（项目使用按需引入，
 *    ElMessageBox 在组件树之外渲染，拿不到 ElConfigProvider 的语言包），
 *    因此显式指定中文按钮，保证交互文案稳定。
 * 3. 用户取消时返回 false，调用方无需再写 try/catch。
 */
import { ElMessageBox } from '@/utils/element'

const CONFIRM_TEXT = { confirmButtonText: '确定', cancelButtonText: '取消' }

/**
 * 危险操作二次确认
 * @param {string} message 提示内容
 * @param {string} [title='操作确认']
 * @param {object} [options] 透传给 ElMessageBox 的额外配置
 * @returns {Promise<boolean>} 用户是否确认
 */
export async function confirm(message, title = '操作确认', options = {}) {
  try {
    await ElMessageBox.confirm(message, title, {
      type: 'warning',
      ...CONFIRM_TEXT,
      ...options,
    })
    return true
  } catch {
    // 用户点击取消或关闭
    return false
  }
}

/**
 * 删除类操作的统一确认文案
 * @param {string} target 目标描述，如「设备 GW-10001」
 */
export function confirmDelete(target) {
  return confirm(`确认删除${target}？该操作不可恢复。`, '删除确认')
}
