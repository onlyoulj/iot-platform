import { ref, getCurrentInstance, onMounted } from 'vue'
import { ElMessage } from '@/utils/element'

/**
 * 通用异步请求封装
 * ------------------------------------------------------------------
 * 适用于详情、统计、下拉选项等一次性请求，统一 loading 与错误提示。
 *
 * @param {() => Promise<any>} fetcher 无参异步函数
 * @param {object} [options]
 * @param {any} [options.initial=null] 初始值
 * @param {boolean} [options.immediate=false] 是否 onMounted 自动执行
 * @param {boolean} [options.silent=false] 是否静默（不弹错误提示）
 * @param {(err: Error) => void} [options.onError]
 */
export function useAsyncData(fetcher, options = {}) {
  const { initial = null, immediate = false, silent = false, onError } = options

  const data = ref(initial)
  const loading = ref(false)
  const error = ref(null)

  async function execute(...args) {
    loading.value = true
    error.value = null
    try {
      const res = await fetcher(...args)
      data.value = res
      return res
    } catch (err) {
      error.value = err
      if (onError) onError(err)
      else if (!silent) ElMessage.error(err?.message || '请求失败')
      return null
    } finally {
      loading.value = false
    }
  }

  if (immediate && getCurrentInstance()) {
    onMounted(execute)
  }

  return { data, loading, error, execute }
}

/**
 * 包裹一个异步操作，统一 loading 与错误提示。
 * 适合"点击按钮触发的动作"（提交表单、发布、删除等）。
 *
 * @param {(...args:any[]) => Promise<any>} action
 * @param {object} [options]
 * @param {boolean} [options.successTip] 成功后的提示文案
 * @returns {{ run: Function, loading: import('vue').Ref<boolean> }}
 */
export function useAction(action, options = {}) {
  const { successTip } = options
  const loading = ref(false)

  async function run(...args) {
    loading.value = true
    try {
      const res = await action(...args)
      if (successTip) ElMessage.success(successTip)
      return res
    } catch (err) {
      // 用户主动取消（ElMessageBox cancel）不提示错误
      if (err === 'cancel' || err === 'close') return null
      ElMessage.error(err?.message || '操作失败')
      return null
    } finally {
      loading.value = false
    }
  }

  return { run, loading }
}

export default useAsyncData
