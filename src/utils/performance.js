/**
 * 前端性能优化工具集
 * ------------------------------------------------------------------
 * 提供 debounce / throttle / rafThrottle / requestIdleCallback 封装，
 * 统一处理高频事件（resize、scroll、搜索输入等），避免不必要的重排重绘。
 */

/**
 * 防抖函数：延迟 wait 毫秒后执行 fn；若在等待期内再次调用则重新计时。
 * 适用于：搜索输入、窗口 resize、表单自动保存。
 *
 * @param {Function} fn  目标函数
 * @param {number} wait  等待毫秒数，默认 300
 * @param {boolean} immediate  是否在首次调用时立即执行一次
 * @returns {Function} 包装后的函数（带 .cancel() 和 .flush() 方法）
 */
export function debounce(fn, wait = 300, immediate = false) {
  let timer = null

  function debounced(...args) {
    if (timer) clearTimeout(timer)
    if (immediate && timer === null) {
      fn.apply(this, args)
    }
    timer = setTimeout(() => {
      timer = null
      if (!immediate) fn.apply(this, args)
    }, wait)
  }

  debounced.cancel = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  debounced.flush = (...args) => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    fn.apply(this, args)
  }

  return debounced
}

/**
 * 节流函数：每 wait 毫秒最多执行一次 fn。
 * 适用于：scroll 加载、按钮防连点、resize 布局计算。
 *
 * @param {Function} fn  目标函数
 * @param {number} wait  间隔毫秒数，默认 200
 * @returns {Function} 包装后的函数（带 .cancel() 方法）
 */
export function throttle(fn, wait = 200) {
  let lastTime = 0
  let timer = null

  function throttled(...args) {
    const now = Date.now()
    const remaining = wait - (now - lastTime)

    if (remaining <= 0) {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      lastTime = now
      fn.apply(this, args)
    } else if (!timer) {
      timer = setTimeout(() => {
        lastTime = Date.now()
        timer = null
        fn.apply(this, args)
      }, remaining)
    }
  }

  throttled.cancel = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    lastTime = 0
  }

  return throttled
}

/**
 * 基于 requestAnimationFrame 的节流。
 * 适用于需要与浏览器渲染周期同步的场景（如滚动位置计算、拖拽定位），
 * 保证每帧最多执行一次，比 setTimeout 更平滑。
 *
 * @param {Function} fn  目标函数
 * @returns {Function} 包装后的函数（带 .cancel() 方法）
 */
export function rafThrottle(fn) {
  let rafId = null

  function throttled(...args) {
    if (rafId !== null) return
    rafId = requestAnimationFrame(() => {
      rafId = null
      fn.apply(this, args)
    })
  }

  throttled.cancel = () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
  }

  return throttled
}

/**
 * requestIdleCallback 封装（降级到 setTimeout）。
 * 适用于：低优先级任务（数据预取、日志上报、离线缓存写入）。
 *
 * @param {Function} fn  目标函数
 * @param {number} timeout  超时毫秒数，确保最终执行
 * @returns {Function}
 */
export function runOnIdle(fn, timeout = 2000) {
  const ric = typeof requestIdleCallback === 'function'
    ? requestIdleCallback
    : (cb) => setTimeout(cb, 0)

  return (...args) => ric(() => fn(...args), { timeout })
}

export default { debounce, throttle, rafThrottle, runOnIdle }
