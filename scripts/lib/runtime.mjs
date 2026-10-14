/**
 * Node 运行时选择与原生绑定自愈
 * ------------------------------------------------------------------
 * 背景：`better-sqlite3` 是原生模块，二进制与 Node 的 ABI（NODE_MODULE_VERSION）强绑定。
 * 本项目 `server/node_modules/better-sqlite3/build/Release/` 下的预编译包由
 * prebuild-install 下载，对应 `node-v127`（Node 22）。若用系统上更高版本的 Node 启动后端，
 * 会报 `NODE_MODULE_VERSION` 不匹配而无法启动。
 *
 * 本模块负责：
 * 1. 枚举本机可用的 Node 运行时；
 * 2. 用「真实实例化数据库」的方式探测哪个运行时能加载原生绑定
 *    （注意：`require('better-sqlite3')` 是懒加载，必须 new 一个实例才能触发原生加载）；
 * 3. 全部不可用时，尝试用 prebuild-install 重新下载预编译包自愈。
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const IS_WIN = process.platform === 'win32'

/**
 * 探测脚本：必须真正 new 一个数据库实例，
 * 因为 better-sqlite3 对原生绑定是惰性加载的，只 require 不会暴露 ABI 问题。
 */
const PROBE_SOURCE = [
  "try{",
  "const D=require('better-sqlite3');",
  "const db=new D(':memory:');db.close();",
  "console.log('PROBE_OK '+process.versions.modules+' '+process.version)",
  "}catch(e){",
  "console.log('PROBE_ERR '+process.versions.modules+' '+process.version+' '+String(e.message).replace(/\\s+/g,' '))",
  "}",
].join('')

export const IS_WINDOWS = IS_WIN

/* ------------------------------ 候选运行时 ------------------------------ */

/** 枚举本机候选 Node 可执行文件（已去重、已解析真实路径） */
export function candidateNodes() {
  const found = []

  const add = (candidate) => {
    if (!candidate) return
    try {
      const real = fs.realpathSync(candidate)
      if (!fs.statSync(real).isFile() || found.includes(real)) return
      found.push(real)
    } catch {
      /* 候选不存在或无权限，跳过 */
    }
  }

  // ① 显式指定（环境变量优先）
  add(process.env.IOT_NODE)
  // ② 当前正在运行本脚本的 Node
  add(process.execPath)

  // ③ WorkBuddy 托管的 Node 版本目录
  const managedRoot = path.join(os.homedir(), '.workbuddy', 'binaries', 'node', 'versions')
  if (fs.existsSync(managedRoot)) {
    for (const dir of fs.readdirSync(managedRoot)) {
      add(path.join(managedRoot, dir, IS_WIN ? 'node.exe' : 'bin/node'))
    }
  }

  // ④ 常见系统安装位置
  if (IS_WIN) {
    add('C:/Program Files/nodejs/node.exe')
    add('C:/Program Files (x86)/nodejs/node.exe')
    add(path.join(os.homedir(), 'AppData/Roaming/nvm/current/node.exe'))
  } else {
    add('/usr/local/bin/node')
    add('/usr/bin/node')
    add('/opt/homebrew/bin/node')
  }

  return found
}

/* ------------------------------ 绑定探测 ------------------------------ */

/** 探测指定 Node 能否加载 better-sqlite3 原生绑定 */
export function probeBinding(nodeExe, cwd) {
  let out = ''

  try {
    out = execFileSync(nodeExe, ['-e', PROBE_SOURCE], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: 20_000,
    })
  } catch (err) {
    out = `${err.stdout || ''}${err.stderr || ''}`
  }

  const line = out.split(/\r?\n/).find((item) => item.startsWith('PROBE_'))
  if (!line) {
    return { ok: false, abi: null, version: null, reason: '探测脚本无输出（可能不是有效的 Node 可执行文件）' }
  }

  const [, abi, version, ...rest] = line.split(' ')
  const ok = line.startsWith('PROBE_OK ')
  return { ok, abi, version, reason: ok ? '' : rest.join(' ') || '未知错误' }
}

/* ------------------------------ npm 调用 ------------------------------ */

/** 定位给定 Node 自带的 npm-cli.js */
export function findNpmCli(nodeExe) {
  const dir = path.dirname(nodeExe)
  const candidates = [
    // Windows / 官方与托管发行包
    path.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    // Linux / macOS 布局
    path.join(dir, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(dir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ]
  return candidates.find((item) => fs.existsSync(item)) || null
}

/** 用指定 Node 执行 npm 子命令，返回是否成功 */
export function runNpm(nodeExe, args, cwd, { stdio = 'inherit', timeout = 300_000 } = {}) {
  const npmCli = findNpmCli(nodeExe)
  if (!npmCli) return false

  try {
    execFileSync(nodeExe, [npmCli, ...args], {
      cwd,
      stdio,
      timeout,
      windowsHide: true,
    })
    return true
  } catch {
    return false
  }
}

/* ------------------------------ 绑定自愈 ------------------------------ */

/**
 * 修复 better-sqlite3 原生绑定
 * 优先下载官方预编译包（无需本地 C++ 工具链），失败再退回 npm rebuild。
 */
function repairBinding(nodeExe, serverDir, log) {
  const sqliteDir = path.join(serverDir, 'node_modules', 'better-sqlite3')

  // 方案一：prebuild-install 下载预编译二进制（快且无需编译工具链）
  const prebuild = path.join(serverDir, 'node_modules', 'prebuild-install', 'bin.js')
  if (fs.existsSync(prebuild)) {
    log('正在下载 better-sqlite3 预编译二进制…')
    try {
      execFileSync(nodeExe, [prebuild], {
        cwd: sqliteDir,
        stdio: 'inherit',
        timeout: 180_000,
        windowsHide: true,
      })
      return true
    } catch {
      log('预编译包下载失败，改用 npm rebuild 重试…', 'warn')
    }
  }

  // 方案二：npm rebuild（依赖本地 C++ 工具链，较慢且不一定成功）
  log('正在执行 npm rebuild better-sqlite3…')
  return runNpm(nodeExe, ['rebuild', 'better-sqlite3', '--foreground-scripts'], serverDir)
}

/* ------------------------------ 对外主流程 ------------------------------ */

/**
 * 挑选可用于启动后端的 Node 运行时
 * @param {{ serverDir: string, log?: Function }} options
 * @returns {{
 *   ok: boolean, node: string, abi: string|null, version: string|null,
 *   repaired: boolean, attempts: Array, reason?: string
 * }}
 */
export function resolveServerRuntime({ serverDir, log = () => {} }) {
  const nodes = candidateNodes()

  if (!nodes.length) {
    return { ok: false, node: process.execPath, abi: null, version: null, repaired: false, attempts: [], reason: '未找到任何 Node 运行时' }
  }

  const scan = () =>
    nodes.map((exe) => {
      const result = probeBinding(exe, serverDir)
      return { exe, ...result }
    })

  // ① 直接找可用的
  let attempts = scan()
  let hit = attempts.find((item) => item.ok)
  if (hit) {
    return { ok: true, node: hit.exe, abi: hit.abi, version: hit.version, repaired: false, attempts }
  }

  // ② 都不行 —— 尝试用当前运行时修复原生绑定后重扫
  const reason = attempts[0]?.reason || '未知错误'
  log('检测到 better-sqlite3 原生绑定不可用，尝试自动修复…', 'warn')

  const repaired = repairBinding(nodes[0], serverDir, log)
  if (repaired) {
    attempts = scan()
    hit = attempts.find((item) => item.ok)
    if (hit) {
      return { ok: true, node: hit.exe, abi: hit.abi, version: hit.version, repaired: true, attempts }
    }
  }

  return { ok: false, node: nodes[0], abi: null, version: null, repaired, attempts, reason }
}

/** 打印运行时诊断信息，便于用户自助排查 */
export function describeAttempts(attempts) {
  return attempts
    .map((item) => {
      const state = item.ok ? '可用' : '不可用'
      const detail = item.ok
        ? `Node ${item.version} (ABI ${item.abi})`
        : `Node ${item.version || '?'} (ABI ${item.abi || '?'}) — ${item.reason}`
      return `    ${state}：${item.exe}\n      ${detail}`
    })
    .join('\n')
}
