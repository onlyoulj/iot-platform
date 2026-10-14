import { ref, getCurrentInstance, onMounted } from 'vue'
import { ElMessage } from '@/utils/element'

/**
 * 分页列表通用逻辑
 * ------------------------------------------------------------------
 * 集中处理：列表数据、总数、页码、loading、错误提示、查询/重置。
 * 使用 @current-change / @size-change 事件而非 watch，
 * 避免"筛选后重置页码"与"分页变化"同时触发导致的重复请求。
 *
 * @param {(pagination: {page:number, pageSize:number}) => Promise<any>} fetchPage
 *        接收分页参数并返回 { list, total } 或数组
 * @param {object} [options]
 * @param {number} [options.pageSize=10] 默认每页条数
 * @param {string} [options.rowKey='id'] 用于去重的字段（暂未使用，预留）
 * @param {boolean} [options.immediate=true] 是否自动加载
 * @param {(err: Error) => void} [options.onError] 自定义错误处理
 */
export function usePagination(fetchPage, options = {}) {
  const { pageSize = 10, immediate = true, onError } = options

  const list = ref([])
  const total = ref(0)
  const page = ref(1)
  const size = ref(pageSize)
  const loading = ref(false)
  const error = ref(null)

  /** 加载当前页数据 */
  async function load() {
    loading.value = true
    error.value = null
    try {
      const res = await fetchPage({ page: page.value, pageSize: size.value })
      if (Array.isArray(res)) {
        list.value = res
        total.value = res.length
      } else {
        list.value = res?.list ?? []
        total.value = res?.total ?? 0
      }
      return res
    } catch (err) {
      error.value = err
      if (onError) onError(err)
      else ElMessage.error(err?.message || '数据加载失败')
      throw err
    } finally {
      loading.value = false
    }
  }

  /** 条件查询：回到第一页再加载（页码没变时手动触发一次，避免漏请求） */
  function search() {
    if (page.value !== 1) {
      page.value = 1
      return load()
    }
    return load()
  }

  /** 重置到第一页 */
  function reset() {
    page.value = 1
    return load()
  }

  /** el-pagination 页码变化 */
  function handlePageChange(nextPage) {
    page.value = nextPage
    return load()
  }

  /** el-pagination 每页条数变化 */
  function handleSizeChange(nextSize) {
    size.value = nextSize
    page.value = 1
    return load()
  }

  /** 删除后如果当前页已空，自动回退一页 */
  async function reloadAfterRemove(removedCount = 1) {
    const remain = total.value - removedCount
    const maxPage = Math.max(1, Math.ceil(remain / size.value))
    page.value = Math.min(page.value, maxPage)
    return load()
  }

  if (immediate && getCurrentInstance()) {
    onMounted(load)
  }

  return {
    list,
    total,
    page,
    size,
    loading,
    error,
    load,
    search,
    reset,
    handlePageChange,
    handleSizeChange,
    reloadAfterRemove,
  }
}

export default usePagination
