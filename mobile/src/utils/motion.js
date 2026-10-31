import { reactive, onUnmounted } from 'vue'

/**
 * 统计数字滚动（概览/告警统计卡用）。
 * values 初始为 null，模板使用 `values.x ?? '-'` 展示占位；
 * 每次 update 从当前显示值缓动到接口新值，避免数字生硬跳变。
 *
 * 用 setInterval + performance.now 而非 rAF：
 * rAF 在后台标签页 / 部分内嵌 WebView 中会被挂起，数字会一直停在占位符；
 * 定时器虽可能被降频，但每次按真实经过时间计算进度，最终一定会落到目标值。
 */
export function useCountUp(keys, { duration = 700 } = {}) {
  const values = reactive({})
  const from = {}
  const to = {}

  keys.forEach((k) => {
    values[k] = null
    from[k] = 0
    to[k] = 0
  })

  let timer = 0
  let startAt = 0

  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3)

  function step() {
    const now = performance.now()
    if (!startAt) startAt = now
    const p = Math.min(1, (now - startAt) / duration)
    const eased = easeOutCubic(p)
    keys.forEach((k) => {
      values[k] = Math.round(from[k] + (to[k] - from[k]) * eased)
    })
    if (p >= 1) {
      clearInterval(timer)
      timer = 0
    }
  }

  function update(source) {
    if (!source) return
    let changed = false
    keys.forEach((k) => {
      const target = Number(source[k])
      if (!Number.isFinite(target)) return
      from[k] = values[k] == null ? 0 : values[k]
      to[k] = target
      changed = true
    })
    if (!changed) return
    if (timer) clearInterval(timer)
    startAt = 0
    step()
    timer = setInterval(step, 16)
  }

  onUnmounted(() => {
    if (timer) clearInterval(timer)
  })

  return { values, update }
}
