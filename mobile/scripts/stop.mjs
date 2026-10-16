#!/usr/bin/env node
/**
 * 停止脚本：释放本项目占用的前后端端口
 * ------------------------------------------------------------------
 * 与 start.mjs 使用同一套端口逻辑，可在另一个终端执行，
 * 用于一键启动脚本被强制关闭后残留进程的清理。
 *
 * 用法：
 *   node scripts/stop.mjs [--api-port 3000] [--web-port 5173] [--dry-run]
 */
import { findPortOccupants, releasePort } from './lib/ports.mjs'

const color = {
  dim: (text) => (process.stdout.isTTY ? `\u001b[90m${text}\u001b[0m` : text),
  red: (text) => (process.stdout.isTTY ? `\u001b[31m${text}\u001b[0m` : text),
  green: (text) => (process.stdout.isTTY ? `\u001b[32m${text}\u001b[0m` : text),
}

function parseArgs(argv) {
  const options = { apiPort: 3000, webPort: 5173, dryRun: false }

  for (let i = 0; i < argv.length; i += 1) {
    const [flag, inlineValue] = argv[i].includes('=') ? argv[i].split(/=(.*)/s, 2) : [argv[i], null]
    const value = () => inlineValue ?? argv[++i]

    if (flag === '--api-port') options.apiPort = Number(value())
    else if (flag === '--web-port' || flag === '--port') options.webPort = Number(value())
    else if (flag === '--dry-run') options.dryRun = true
  }

  return options
}

const options = parseArgs(process.argv.slice(2))
const targets = [
  { label: '后端', port: options.apiPort },
  { label: '前端', port: options.webPort },
]

console.log()
console.log('  停止 IoT 平台服务')
console.log()

let failed = false

for (const target of targets) {
  const occupants = findPortOccupants(target.port)

  if (!occupants.length) {
    console.log(`  ${color.green('○')} ${target.label}端口 ${target.port} 未占用`)
    continue
  }

  const result = releasePort(target.port, {
    log: (message) => console.log(`  ${color.dim('·')} ${message}`),
    dryRun: options.dryRun,
  })

  if (!result.freed) {
    failed = true
    console.log(`  ${color.red('✗')} ${target.label}端口 ${target.port} 仍未释放（PID：${result.remaining.join(', ')}）`)
  } else if (!options.dryRun) {
    console.log(`  ${color.green('✓')} ${target.label}端口 ${target.port} 已释放`)
  }
}

console.log()
process.exit(failed ? 1 : 0)
