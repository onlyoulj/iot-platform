/**
 * 剪贴板工具
 * ------------------------------------------------------------------
 * 优先使用异步 Clipboard API（要求 HTTPS 或 localhost），
 * 不可用时降级为 textarea + execCommand，兼容内网 HTTP 访问与旧浏览器。
 */

/**
 * 复制文本到剪贴板
 * @param {string} text 待复制内容
 * @returns {Promise<boolean>} 是否复制成功，由调用方决定提示文案
 */
export async function copyText(text) {
  const value = String(text ?? '')
  if (!value) return false

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value)
      return true
    } catch {
      // 非安全上下文或用户拒绝授权，走下面的降级方案
    }
  }

  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.top = '-9999px'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)

  textarea.select()
  textarea.setSelectionRange(0, value.length)

  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  } finally {
    document.body.removeChild(textarea)
  }

  return ok
}

export default copyText
