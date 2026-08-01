#!/usr/bin/env node
/* Generate the extension's PNG icons with nothing but node:zlib.
 *
 *   node extension/icons/make-icons.mjs
 *
 * Why PNG and not SVG: Chrome's manifest `icons` and `action.default_icon`
 * take raster images only. Firefox accepts SVG there; Chrome does not, and
 * an SVG path silently falls back to the puzzle-piece icon. Verified against
 * the MV3 manifest reference — this is a real constraint, not caution.
 *
 * The mark: amber rounded square, dark bolt, 3x supersampled so the 16px
 * favicon-sized copy does not turn to mush.
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

const AMBER = [245, 158, 11, 255] // #f59e0b
const INK = [20, 16, 10, 255] // #14100a
const CLEAR = [0, 0, 0, 0]

// Lightning bolt in a unit square, wound clockwise.
const BOLT = [
  [0.60, 0.06], [0.26, 0.56], [0.45, 0.56],
  [0.38, 0.94], [0.75, 0.42], [0.54, 0.42],
]

function inPolygon(x, y, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function inRoundRect(x, y, r) {
  // x,y in [0,1]; r is the corner radius as a fraction of the side.
  const cx = Math.min(Math.max(x, r), 1 - r)
  const cy = Math.min(Math.max(y, r), 1 - r)
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= r * r + 1e-9
}

function render(size) {
  const SS = 3 // supersampling factor
  const radius = size <= 20 ? 0.18 : 0.22
  const px = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let acc = [0, 0, 0, 0]
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size
          const v = (y + (sy + 0.5) / SS) / size
          let c = CLEAR
          if (inRoundRect(u, v, radius)) c = inPolygon(u, v, BOLT) ? INK : AMBER
          // premultiply so transparent corners do not fringe
          acc[0] += (c[0] * c[3]) / 255
          acc[1] += (c[1] * c[3]) / 255
          acc[2] += (c[2] * c[3]) / 255
          acc[3] += c[3]
        }
      }
      const n = SS * SS
      const a = acc[3] / n
      const o = (y * size + x) * 4
      px[o] = a > 0 ? Math.round((acc[0] / n / a) * 255) : 0
      px[o + 1] = a > 0 ? Math.round((acc[1] / n / a) * 255) : 0
      px[o + 2] = a > 0 ? Math.round((acc[2] / n / a) * 255) : 0
      px[o + 3] = Math.round(a)
    }
  }
  return px
}

// --- minimal PNG encoder -------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function png(size, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // truecolour with alpha
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0 // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

for (const size of [16, 32, 48, 128]) {
  const buf = png(size, render(size))
  const out = join(here, `icon-${size}.png`)
  writeFileSync(out, buf)
  console.log(`icon-${size}.png  ${buf.length}b`)
}
