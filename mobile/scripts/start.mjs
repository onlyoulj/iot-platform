#!/usr/bin/env node
/**
 * 一键启动脚本（开发模式）
 * ------------------------------------------------------------------
 * 依次完成：
 *   1. 检查前后端依赖是否安装，缺失则自动 npm install；
 *   2. 挑选能加载 better-sqlite3 原生绑定的 Node 运行时（ABI 强绑定，见 lib/runtime.mjs）；
 *   3. 【端口被占用时自动结束占用进程】；
 *   4. 并行拉起后端 API 与前端开发服务器，日志加前缀区分；
 *   5. 健康检查通过后打印访问地址；Ctrl+C 一键停止全部服务。
 *
 * 用法：
 *   node scripts/start.mjs [选项]        或      npm start -- [选项]
 *
 * 选项：
 *   --api-port <n>     后端端口，默认 3001
 *   --web-port <n>     前端端口，默认 5174（别名 --port）
 *   --host <addr>      前端监听地址，默认取 vite.config.js
 *   --no-kill          端口被占用时只提示，不结束占用进程
 *   --no-wait          启动后不做健康检查，直接返回
 *   --watch            后端以 --watch 模式运行（改代码自动重启）
 *   --backend-only     只启动后端
 *   --frontend-only    只启动前端
 *   --skip-check       跳过 Node 运行时与原生绑定预检
 *   --force            健康检查失败也保持运行
 *   -h, --help         显示帮助
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { findPortOccupants, releasePort } from './lib/ports.mjs'
import { describeAttempts, resolveServerRuntime, runNpm } from './lib/runtime.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SERVER_DIR = path.join(ROOT, 'server')
const IS_WIN = process.platform === 'win32'

/* ------------------------------- 终端着色 ------------------------------- */

const COLOR_ENABLED = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR
const paint = (code) => (text) => (COLOR_ENABLED ? `\u001b[${code}m${text}\u001b[0m` : String(text))

const color = {
  dim: paint(90),
  bold: paint(1),
  red: paint(31),
  green: paint(32),
  yellow: paint(33),
  blue: paint(34),
  cyan: paint(36),
  magenta: paint(35),
}

const log = (message) => console.log(`${color.blue('[启动]')} ${message}`)
const ok = (message) => console.log(`${color.green('[  OK]')} ${message}`)
const warn = (message) => console.log(`${color.yellow('[警告]')} ${message}`)
const fail = (message) => console.error(`${color.red('[失败]')} ${message}`)

/* ------------------------------- 参数解析 ------------------------------- */

const HELP_TEXT = `
IoT 平台一键启动脚本

用法： node scripts/start.mjs [选项]

选项：
  --api-port <n>     后端端口（默认 3001）
  --web-port <n>     前端端口（默认 5174，别名 --port）
  --host <addr>      前端监听地址（默认取 vite.config.js）
  --no-kill          端口被占用时只提示，不结束占用进程
  --no-wait          启动后不做健康检查
  --watch            后端以 --watch 模式运行
  --backend-only     只启动后端
  --frontend-only    只启动前端
  --skip-check       跳过 Node 运行时与原生绑定预检
  --force            健康检查失败也保持运行
  -h, --help         显示本帮助
`

function parseArgs(argv) {
  const options = {
    apiPort: 3001,
    webPort: 5174,
    host: null,
    kill: true,
    wait: true,
    watch: false,
    backend: true,
    frontend: true,
    skipCheck: false,
    force: false,
    help: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i]
    const [flag, inlineValue] = raw.includes('=') ? raw.split(/=(.*)/s, 2) : [raw, null]
    const nextValue = () => inlineValue ?? argv[++i]

    switch (flag) {
      case '--api-port':
        options.apiPort = Number(nextValue())
        break
      case '--web-port':
      case '--port':
        options.webPort = Number(nextValue())
        break
      case '--host':
        options.host = nextValue()
        break
      case '--no-kill':
        options.kill = false
        break
      case '--no-wait':
        options.wait = false
        break
      case '--watch':
        options.watch = true
        break
      case '--backend-only':
        options.frontend = false
        break
      case '--frontend-only':
        options.backend = false
        break
      case '--skip-check':
        options.skipCheck = true
        break
      case '--force':
        options.force = true
        break
      case '-h':
      case '--help':
        options.help = true
        break
      default:
        if (flag.startsWith('-')) warn(`未知参数：${flag}（已忽略）`)
    }
  }

  for (const key of ['apiPort', 'webPort']) {
    if (!Number.isInteger(options[key]) || options[key] <= 0 || options[key] > 65535) {
      fail(`端口不合法：${options[key]}，将使用默认值`)
      options[key] = key === 'apiPort' ? 3001 : 5174
    }
  }

  return options
}

/* ------------------------------- 依赖检查 ------------------------------- */

const DEPENDENCIES = [
  {
    label: '前端依赖',
    dir: ROOT,
    probe: path.join(ROOT, 'node_modules', 'vite', 'package.json'),
  },
  {
    label: '后端依赖',
    dir: SERVER_DIR,
    probe: path.join(SERVER_DIR, 'node_modules', 'better-sqlite3', 'package.json'),
  },
]

function ensureDependencies(needed) {
  for (const dep of needed) {
    if (fs.existsSync(dep.probe)) continue

    log(`${dep.label}未安装，正在执行 npm install（首次安装可能需要几分钟）…`)
    const done = runNpm(process.execPath, ['install', '--no-audit', '--no-fund'], dep.dir)

    if (!done || !fs.existsSync(dep.probe)) {
      fail(`${dep.label}安装失败，请手动在 ${dep.dir} 下执行 npm install`)
      process.exit(1)
    }
    ok(`${dep.label}安装完成`)
  }
}

/* ------------------------------- 进程工具 ------------------------------- */

const services = []
let shuttingDown = false

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 把子进程输出按行加上前缀后实时转发到当前终端 */
function attachStream(stream, prefix, paintPrefix) {
  if (!stream) return

  let buffer = ''
  const flush = (line) => {
    process.stdout.write(`${paintPrefix(prefix)} ${line}\n`)
  }

  stream.setEncoding('utf8')
  stream.on('data', (chunk) => {
    buffer += chunk
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    for (const line of lines) flush(line)
  })
  stream.on('end', () => {
    if (buffer) flush(buffer)
    buffer = ''
  })
}

function startService({ name, prefix, paintPrefix, exe, args, cwd, env = {} }) {
  const child = spawn(exe, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
  })

  // 子进程输出已实时转发，这里不再缓存日志（避免外部停止时重复刷屏）
  attachStream(child.stdout, prefix, paintPrefix)
  attachStream(child.stderr, prefix, paintPrefix)

  const service = { name, prefix, child, exited: false }

  child.on('error', (err) => {
    fail(`${name}进程无法启动：${err.message}`)
  })

  child.on('exit', (code, signal) => {
    service.exited = true
    if (shuttingDown || child.__expectedExit) return

    // 被 kill 时 Windows 会给出 code=1，类 Unix 会给出 signal；
    // 这种情况下很可能是在另一个终端执行了 npm run stop，没必要惊动用户。
    const stoppedExternally = Boolean(signal) || code === 1
    warn(
      stoppedExternally
        ? `${name}进程已退出（可能被外部停止，例如另开终端执行了 npm run stop），正在停止其余服务…`
        : `${name}进程意外退出（code=${code} signal=${signal}），正在停止其余服务…`
    )
    shutdown(1)
  })

  services.push(service)
  return service
}

/** 记录我们认为子进程会正常退出（主动停止时用） */
function markExpectedExit(service) {
  if (service?.child) service.child.__expectedExit = true
}

/* ------------------------------- 端口清理 ------------------------------- */

function freePort(port, label) {
  const occupants = findPortOccupants(port)
  if (!occupants.length) {
    ok(`${label}端口 ${port} 空闲`)
    return true
  }

  const result = releasePort(port, {
    log: (message, level) => (level === 'warn' ? warn(message) : log(message)),
    dryRun: !startingOptions.kill,
  })

  if (!result.freed) {
    fail(`${label}端口 ${port} 仍被占用（PID：${result.remaining.join(', ')}），请手动处理后重试`)
    return false
  }

  if (startingOptions.kill) ok(`${label}端口 ${port} 已释放`)
  return true
}

/* ------------------------------- 健康检查 ------------------------------- */

async function waitForHttp(url, { timeout = 30_000, interval = 350 } = {}) {
  const deadline = Date.now() + timeout

  while (Date.now() < deadline) {
    if (shuttingDown) return false
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2500) })
      if (response.status < 500) return true
    } catch {
      /* 服务尚未就绪，继续轮询 */
    }
    await delay(interval)
  }

  return false
}

/* ------------------------------- 关闭流程 ------------------------------- */

function shutdown(exitCode = 0) {
  if (shuttingDown) return
  shuttingDown = true

  const running = services.filter((service) => !service.exited && service.child.pid)
  if (running.length) {
    console.log()
    log('正在停止服务…')
    for (const service of running) {
      markExpectedExit(service)
      const pid = service.child.pid
      if (IS_WIN) {
        // Windows 下必须连带子进程一起结束，否则会残留 node 进程占着端口
        spawn('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true })
      } else {
        try {
          process.kill(pid, 'SIGTERM')
        } catch {
          /* 忽略已退出的情况 */
        }
      }
    }
  }

  setTimeout(() => process.exit(exitCode), 700)
}

/* ------------------------------- 输出信息 ------------------------------- */

function printHeader(options) {
  const scope = options.backend && options.frontend ? '前端 + 后端' : options.backend ? '仅后端' : '仅前端'
  console.log()
  console.log(color.bold('  IoT 平台 · 一键启动'))
  console.log(color.dim(`  工作目录：${ROOT}`))
  console.log(color.dim(`  启动范围：${scope}`))
  console.log()
}

function printRuntimeFailure(runtime) {
  console.log()
  fail('没有找到能加载 better-sqlite3 原生绑定的 Node 运行时')
  console.log()
  console.log('  已探测的运行时：')
  console.log(describeAttempts(runtime.attempts))
  console.log()
  console.log('  原因：better-sqlite3 是原生模块，其二进制与 Node 的 ABI 版本强绑定；')
  console.log('        当前已下载的预编译包只匹配特定 Node 版本，其余版本会报')
  console.log('        NODE_MODULE_VERSION 不匹配。')
  console.log()
  console.log('  解决办法（任选其一）：')
  console.log('    1) 用匹配的 Node 启动，例如：')
  console.log(color.cyan('         IOT_NODE="/path/to/node22/node" npm start'))
  console.log('    2) 为当前 Node 重新下载预编译包：')
  console.log(color.cyan('         cd server/node_modules/better-sqlite3 && node ../prebuild-install/bin.js'))
  console.log('    3) 跳过预检强行启动（后端可能起不来）：')
  console.log(color.cyan('         npm start -- --skip-check'))
  console.log()
}

function printReady(options, info) {
  const host = options.host && options.host !== '0.0.0.0' ? options.host : 'localhost'
  const line = color.dim('  ' + '─'.repeat(50))

  console.log()
  console.log(line)
  console.log(`  ${color.green('✅ 服务已就绪')}`)
  console.log()
  if (options.frontend) {
    console.log(`  ${color.bold('前端控制台')}   ${color.cyan(`http://${host}:${options.webPort}`)}`)
  }
  if (options.backend) {
    console.log(`  ${color.bold('后端 API  ')}   ${color.cyan(`http://${host}:${options.apiPort}/api`)}`)
    console.log(`  ${color.bold('健康检查  ')}   ${color.dim(`http://${host}:${options.apiPort}/api/health`)}`)
  }
  if (info.nodeLabel) {
    console.log()
    console.log(`  ${color.dim('后端运行时')}   ${color.dim(info.nodeLabel)}`)
  }
  console.log()
  console.log(`  ${color.dim('按 Ctrl+C 停止全部服务，或在另一个终端执行')} npm run stop`)
  console.log(line)
  console.log()
}

/* ------------------------------- 主流程 ------------------------------- */

const startingOptions = parseArgs(process.argv.slice(2))

async function main() {
  const options = startingOptions

  if (options.help) {
    console.log(HELP_TEXT)
    return 0
  }

  printHeader(options)

  // ① 依赖
  const neededDeps = []

  if (options.frontend) neededDeps.push(DEPENDENCIES[0])

  if (options.backend) neededDeps.push(DEPENDENCIES[1])

  if (neededDeps.length) ensureDependencies(neededDeps)
  else log('未选择任何服务，退出')

  if (!options.backend && !options.frontend) return 1

  // ② Node 运行时（后端对 ABI 敏感，需先选出能加载原生绑定的版本）
  let nodeExe = process.execPath
  let nodeLabel = ''

  if (options.backend) {
    if (options.skipCheck) {
      warn('已跳过 Node 运行时预检（--skip-check）')
    } else {
      log('正在检查后端 Node 运行时与 better-sqlite3 原生绑定…')
      const runtime = resolveServerRuntime({ serverDir: SERVER_DIR, log })

      if (!runtime.ok) {
        printRuntimeFailure(runtime)
        return 1
      }

      nodeExe = runtime.node
      nodeLabel = `Node ${runtime.version}（ABI ${runtime.abi}）`

      if (runtime.repaired) ok('原生绑定已自动修复')
      if (path.resolve(nodeExe) !== path.resolve(process.execPath)) {
        ok(`已自动切换运行时：${nodeLabel}`)
      } else {
        ok(`运行时可用：${nodeLabel}`)
      }
    }
  }

  // ③ 端口清理
  if (options.backend && !freePort(options.apiPort, '后端')) return 1
  if (options.frontend && !freePort(options.webPort, '前端')) return 1

  // ④ 启动服务
  if (options.backend) {
    const args = options.watch ? ['--watch', 'index.js'] : ['index.js']
    startService({
      name: '后端',
      prefix: '[后端]',
      paintPrefix: color.cyan,
      exe: nodeExe,
      args,
      cwd: SERVER_DIR,
      env: { PORT: String(options.apiPort) },
    })
    log(`后端已拉起：${path.basename(nodeExe)} ${args.join(' ')}`)
  }

  if (options.frontend) {
    const viteBin = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js')
    if (!fs.existsSync(viteBin)) {
      fail(`未找到 Vite：${viteBin}`)
      return 1
    }

    const args = [viteBin, '--port', String(options.webPort), '--strictPort']
    if (options.host) args.push('--host', options.host)

    startService({
      name: '前端',
      prefix: '[前端]',
      paintPrefix: color.magenta,
      exe: nodeExe,
      args,
      cwd: ROOT,
      // 端口若被改过，同步告知 Vite 把 /api 代理到正确的后端
      env: { VITE_PROXY_TARGET: `http://127.0.0.1:${options.apiPort}` },
    })
    log(`前端已拉起：vite --port ${options.webPort}`)
  }

  if (!options.wait) {
    printReady(options, { nodeLabel })
    return null
  }

  // ⑤ 健康检查
  console.log()
  log('等待服务就绪…')

  const checks = []

  if (options.backend) {
    checks.push({
      name: '后端 API',
      run: () =>
        waitForHttp(`http://127.0.0.1:${options.apiPort}/api/health`, { timeout: 30_000 }).then((ready) => {
          ready ? ok(`后端 API 已就绪（:${options.apiPort}）`) : fail(`后端 API 30 秒内未就绪（:${options.apiPort}）`)
          return ready
        }),
    })
  }

  if (options.frontend) {
    checks.push({
      name: '前端',
      run: () =>
        waitForHttp(`http://127.0.0.1:${options.webPort}/`, { timeout: 60_000 }).then((ready) => {
          ready ? ok(`前端已就绪（:${options.webPort}）`) : fail(`前端 60 秒内未就绪（:${options.webPort}）`)
          return ready
        }),
    })
  }

  const results = await Promise.all(checks.map((check) => check.run()))
  const failed = checks.filter((_, index) => !results[index])

  if (failed.length) {
    if (!options.force) {
      console.log()
      fail(`以下服务未就绪：${failed.map((item) => item.name).join('、')}`)
      console.log(color.dim('  提示：加上 --force 可在健康检查失败时保持运行，便于查看日志。'))
      return 1
    }
    warn('存在未就绪的服务，但已按 --force 保持运行')
  }

  printReady(options, { nodeLabel })
  return null
}

/* ------------------------------- 信号处理 ------------------------------- */

process.on('SIGINT', () => {
  console.log()
  shutdown(0)
})
process.on('SIGTERM', () => shutdown(0))
process.on('uncaughtException', (err) => {
  fail(`未捕获异常：${err?.stack || err}`)
  shutdown(1)
})

main()
  .then((code) => {
    if (code !== null) shutdown(code)
    // code === null 表示需要常驻，等待信号
  })
  .catch((err) => {
    fail(`启动失败：${err?.stack || err}`)
    shutdown(1)
  })
