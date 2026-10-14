#!/usr/bin/env bash
# ============================================================
#  IoT 平台一键启动（后端 + 前端）
#
#  实际逻辑在 scripts/start.mjs，Windows / macOS / Linux 共用：
#    · 端口被占用时自动结束占用进程
#    · 自动挑选与 better-sqlite3 原生绑定兼容的 Node 运行时
#    · 前后端一起启动，日志带前缀
#    · Ctrl+C 一键停止全部服务
#
#  用法：./start.sh [--no-kill] [--watch] [--backend-only] [--frontend-only]
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

find_node() {
  # ① 环境变量显式指定
  if [ -n "${IOT_NODE:-}" ] && [ -x "${IOT_NODE}" ]; then
    printf '%s' "${IOT_NODE}"
    return 0
  fi
  # ② PATH 中的 node
  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi
  # ③ 常见安装位置
  for candidate in \
    "$HOME/.workbuddy/binaries/node/versions/current/bin/node" \
    "$HOME/.workbuddy/binaries/node/versions/current/node.exe" \
    /usr/local/bin/node \
    /opt/homebrew/bin/node \
    /usr/bin/node \
    "/c/Program Files/nodejs/node.exe"; do
    # 目录通配（托管版本目录名带后缀）
    if [ -x "$candidate" ]; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  # ④ 托管目录下逐个版本尝试
  for candidate in "$HOME/.workbuddy/binaries/node/versions"/*/bin/node; do
    if [ -x "$candidate" ]; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  return 1
}

NODE_BIN="$(find_node || true)"

if [ -z "${NODE_BIN:-}" ]; then
  echo "✗ 未找到 Node.js，请先安装 Node 22 或更高版本：https://nodejs.org" >&2
  exit 1
fi

exec "$NODE_BIN" "$SCRIPT_DIR/scripts/start.mjs" "$@"
