/**
 * 生成 tabBar PNG 图标（81x81，两色各一套）— 零依赖手写 PNG
 * 用法: node scripts/gen-icons.mjs
 *
 * 用 1bit 位图思路太糙，这里用 RGBA + zlib；图形用逐像素函数绘制。
 */
import zlib from 'node:zlib'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.join(__dirname, '..', 'static', 'tab')
fs.mkdirSync(outDir, { recursive: true })

const S = 81

/** 简单形状判断：返回点 (x,y) 是否在图形内 */
function hexToRgb(hex) {
  const v = parseInt(hex.slice(1), 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}

function inCircle(cx, cy, r) {
  return (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}

function inRect(x0, y0, x1, y1) {
  return (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1
}

function union(...fns) {
  return (x, y) => fns.some((f) => f(x, y))
}

function minus(a, b) {
  return (x, y) => a(x, y) && !b(x, y)
}

// ---- 各图标形状（画布 81x81，留 6px 边距）----
const shapes = {
  home: union(
    // 屋顶三角
    (x, y) => y >= 10 && y <= 36 && x >= 40 - (y - 10) * 0.9 && x <= 40 + (y - 10) * 0.9,
    // 房身
    inRect(16, 36, 64, 68),
    // 门（挖掉）
  ),
  device: (x, y) => {
    const body = inRect(24, 10, 56, 70)(x, y) && Math.abs(x - 40) <= 16
    const hole = inRect(30, 20, 50, 52)(x, y)
    return body && !hole
  },
  alert: union(
    // 铃身（半圆+梯形）
    (x, y) => {
      if (y >= 14 && y <= 44) {
        const half = 14 + (y - 14) * 0.55
        return Math.abs(x - 40) <= half
      }
      if (y > 44 && y <= 54) {
        return Math.abs(x - 40) <= 26
      }
      return false
    },
    inCircle(40, 62, 7),
    inCircle(40, 12, 4),
  ),
  user: union(inCircle(40, 27, 14), (x, y) => y >= 46 && y <= 70 && (x - 40) ** 2 / 28 ** 2 + (y - 74) ** 2 / 30 ** 2 <= 1),
  // 产品（立方体等距投影）：顶面 + 左面 + 右面（中缝留 2px 视觉分隔）
  cube: (x, y) => {
    const cx = 40, topY = 12, midY = 40, botY = 68, halfW = 26
    // 顶面菱形
    if (y >= topY && y <= midY) {
      const spread = ((y - topY) / (midY - topY)) * halfW
      if (Math.abs(x - cx) <= spread) return true
    }
    // 下半部：左右两个侧面梯形，从顶面底边两端收拢到中底点
    if (y > midY && y <= botY) {
      const t = (y - midY) / (botY - midY) // 0→1
      const shrink = halfW * t
      if (x >= cx - halfW && x <= cx - 1 - shrink) return true   // 左侧面
      if (x >= cx + 1 + shrink && x <= cx + halfW) return true   // 右侧面
    }
    return false
  },
}
// home 补门洞
shapes.home = minus(shapes.home, inRect(33, 50, 47, 68))

function writePng(file, pixels) {
  // pixels: Uint8Array S*S*4
  const raw = Buffer.alloc(S * (1 + S * 4))
  for (let y = 0; y < S; y++) {
    raw[y * (1 + S * 4)] = 0 // filter none
    pixels.copy ? pixels.copy(raw, y * (1 + S * 4) + 1, y * S * 4, (y + 1) * S * 4) : null
  }
  const idat = zlib.deflateSync(raw)
  const chunks = []
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const crcTable = []
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c
    }
    let crc = 0xffffffff
    for (const b of body) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8)
    crc = (crc ^ 0xffffffff) >>> 0
    const crcBuf = Buffer.alloc(4)
    crcBuf.writeUInt32BE(crc)
    return Buffer.concat([len, body, crcBuf])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(S, 0)
  ihdr.writeUInt32BE(S, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  chunks.push(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  chunks.push(chunk('IHDR', ihdr))
  chunks.push(chunk('IDAT', idat))
  chunks.push(chunk('IEND', Buffer.alloc(0)))
  fs.writeFileSync(file, Buffer.concat(chunks))
}

for (const [name, test] of Object.entries(shapes)) {
  for (const [suffix, color] of [['', '#8a8f99'], ['-on', '#2b6de8']]) {
    const [r, g, b] = hexToRgb(color)
    const px = Buffer.alloc(S * S * 4)
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        if (test(x, y)) {
          const i = (y * S + x) * 4
          px[i] = r
          px[i + 1] = g
          px[i + 2] = b
          px[i + 3] = 255
        }
      }
    }
    writePng(path.join(outDir, `${name}${suffix}.png`), px)
  }
}
console.log('icons written to', outDir)
