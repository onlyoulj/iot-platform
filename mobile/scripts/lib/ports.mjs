/**
 * 端口占用检测与进程清理（跨平台）
 * ------------------------------------------------------------------
 * - Windows：`netstat -ano` 找 PID，`tasklist` 取进程名，`taskkill /F /T` 结束进程树。
 * - 类 Unix：依次尝试 `lsof` / `ss` / `netstat` 找 PID，`kill` 结束。
 *
 * 设计约定：
 * 1. 所有探测函数都不抛异常 —— 命令不存在或执行失败一律按「没有占用」处理，
 *    真正的判定交给调用方（启动后做健康检查）。
 * 2. 内置自身保护，绝不结束当前进程及其父进程（即启动它的终端）。
 */
import { execFileSync } from 'node:child_process'

const IS_WIN = process.platform === 'win32'

/** 同步等待，避免引入外部依赖 */
function sleepSync(ms) {
  const shared = new SharedArrayBuffer(4)
  Atomics.wait(new Int32Array(shared), 0, 0, ms)
}

/**
 * 执行外部命令，统一吞掉异常。
 * @returns {{ ok: boolean, out: string }} ok 表示退出码为 0
 */
function runCapture(cmd, args, options = {}) {
  try {
    const out = execFileSync(cmd, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: 15_000,
      ...options,
    })
    return { ok: true, out: out || '' }
  } catch (err) {
    // 非零退出码时 stdout/stderr 挂在这个错误对象上
    const out = `${err.stdout || ''}${err.stderr || ''}`
    return { ok: false, out }
  }
}

/** 当前进程与其父进程，用于避免误杀自己 */
const PROTECTED_PIDS = new Set([process.pid, process.ppid].filter(Boolean))

/* ------------------------------- 端口查询 ------------------------------- */

function findOnWindows(port) {
  const { out } = runCapture('netstat', ['-ano'])
  const pids = []

  for (const line of out.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 5) continue

    const [proto, local, , state, pid] = parts
    if (!/^TCP/i.test(proto) || state !== 'LISTENING') continue
    // 只比对本地地址的端口段，避免把远端端口或 15173 之类的端口误判为 5173
    if (local.split(':').pop() !== String(port)) continue

    pids.push(Number(pid))
  }

  return pids
}

function findOnUnix(port) {
  // lsof 最准确，优先使用
  const lsof = runCapture('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'])
  if (lsof.ok && lsof.out.trim()) {
    return lsof.out.split(/\s+/).map(Number)
  }

  // 退化方案：ss（Linux）与 netstat 的 PID 字段
  for (const [cmd, args] of [
    ['ss', ['-ltnpH', `sport = :${port}`]],
    ['netstat', ['-ltnp']],
  ]) {
    const { ok, out } = runCapture(cmd, args)
    if (!ok || !out) continue

    const pids = []
    for (const line of out.split(/\r?\n/)) {
      if (!line.includes(`:${port}`)) continue
      const matched = line.match(/pid=(\d+)/)
      if (matched) pids.push(Number(matched[1]))
    }
    if (pids.length) return pids

    // netstat 老式输出：进程名带 PID 在末尾
    for (const line of out.split(/\r?\n/)) {
      if (!line.includes(`:${port}`)) continue
      const matched = line.match(/(\d+)\s*\/\s*\S+$/)
      if (matched) pids.push(Number(matched[1]))
    }
    if (pids.length) return pids
  }

  return []
}

/**
 * 查询监听指定端口的进程 PID 列表
 * @returns {number[]} 已去重、已剔除自身进程的 PID 数组
 */
export function findPortOccupants(port) {
  const pids = IS_WIN ? findOnWindows(port) : findOnUnix(port)

  return [...new Set(pids)]
    .filter((pid) => Number.isInteger(pid) && pid > 0 && !PROTECTED_PIDS.has(pid))
    .sort((a, b) => a - b)
}

/** 端口当前是否被占用 */
export function isPortInUse(port) {
  return findPortOccupants(port).length > 0
}

/** 等待端口释放 */
export function waitForPortFree(port, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isPortInUse(port)) return true
    sleepSync(150)
  }
  return !isPortInUse(port)
}

/* ------------------------------- 进程信息 ------------------------------- */

/**
 * 取进程名
 * @returns {string|null} 取不到时返回 null（例如进程正在退出的瞬间）
 */
export function getProcessName(pid) {
  if (IS_WIN) {
    // 进程刚创建或刚被结束的瞬间，tasklist 有可能查不到，重试一次更稳妥
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (attempt) sleepSync(150)

      const { out } = runCapture('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'])
      // 形如："node.exe","62168","Console","1","123,456 K"
      const matched = out.match(/"([^"]+)","(\d+)"/)
      if (matched) return matched[1]
    }

    return null
  }

  const { ok, out } = runCapture('ps', ['-p', String(pid), '-o', 'comm='])
  return ok && out.trim() ? out.trim() : null
}

/**
 * 生成进程的可读描述，进程名取不到时退化为 PID
 * @returns {string} 形如 `node.exe (PID 62168)` 或 `PID 62168`
 */
export function describeProcess(pid) {
  const name = getProcessName(pid)
  return name ? `${name} (PID ${pid})` : `PID ${pid}`
}

/* ------------------------------- 进程结束 ------------------------------- */

function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM 说明进程存在但无权限操作，仍视作存活
    return err.code === 'EPERM'
  }
}

/**
 * 结束进程（Windows 连同子进程一起结束，即 Vite / Node 的派生进程）
 * @returns {{ ok: boolean, reason?: string }}
 */
export function killProcess(pid, { tree = true } = {}) {
  if (IS_WIN) {
    // PID 0 = Idle，4 = System，这两个不能碰
    if (pid <= 4) return { ok: false, reason: '系统进程，已跳过' }

    const { ok, out } = runCapture('taskkill', ['/F', ...(tree ? ['/T'] : []), '/PID', String(pid)])
    if (!ok && !/成功|SUCCESS/i.test(out) && isAlive(pid)) {
      return { ok: false, reason: out.trim().split(/\r?\n/).pop() || 'taskkill 执行失败' }
    }
  } else {
    try {
      process.kill(pid, 'SIGTERM')
    } catch (err) {
      return { ok: false, reason: err.code || err.message }
    }

    // 给 2 秒优雅退出时间，超时后强杀
    for (let i = 0; i < 20 && isAlive(pid); i += 1) sleepSync(100)
    if (isAlive(pid)) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        /* 已退出则忽略 */
      }
    }
  }

  for (let i = 0; i < 20 && isAlive(pid); i += 1) sleepSync(100)
  return isAlive(pid) ? { ok: false, reason: '进程仍在运行' } : { ok: true }
}

/**
 * 释放端口：结束所有占用进程
 * @param {number} port
 * @param {{ log?: Function, dryRun?: boolean }} options dryRun=true 时只报告不结束
 * @returns {{ freed: boolean, killed: Array, remaining: number[] }}
 */
export function releasePort(port, { log = () => {}, dryRun = false } = {}) {
  const pids = findPortOccupants(port)
  if (!pids.length) return { freed: true, killed: [], remaining: [] }

  const killed = []

  for (const pid of pids) {
    const label = describeProcess(pid)

    if (dryRun) {
      log(`端口 ${port} 被 ${label} 占用，已按 --no-kill 跳过`)
      continue
    }

    log(`端口 ${port} 被 ${label} 占用，正在结束该进程…`)
    const result = killProcess(pid)
    killed.push({ pid, label, ok: result.ok, reason: result.reason })
    if (!result.ok) log(`  ↓ 结束失败：${result.reason}`, 'warn')
  }

  waitForPortFree(port, 3000)
  const remaining = findPortOccupants(port)
  return { freed: remaining.length === 0, killed, remaining }
}

/**
 * 结束通过 spawn 创建的进程树（用于停止脚本自身拉起的服务）
 */
export function killProcessTree(pid) {
  if (!pid) return
  if (IS_WIN) {
    runCapture('taskkill', ['/F', '/T', '/PID', String(pid)])
    return
  }
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    /* 进程可能已退出 */
  }
}
