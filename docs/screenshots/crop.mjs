// Crop the full-page captures down to something a person will actually look at.
//
// `fullPage: true` produces an honest image and a useless one: /nanda came out
// 2880x9652, a strip you scroll past rather than read, and several dashboards
// were over 4,600px tall. In a README they render as a thin ribbon; in a
// submission they read as nobody having looked at their own screenshots.
//
// This keeps the TOP of each image — which is where the thing being
// demonstrated is — and trims the tail. Nothing is scaled, stretched or
// composited, so what remains is exactly what the product rendered.
//
//   node docs/screenshots/crop.mjs [--max 2.0] [--dry]

import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, renameSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`)
  return i === -1 ? d : Number(process.argv[i + 1])
}

/** Tallest an image may be, as a multiple of its width. */
const MAX_RATIO = arg('max', 1.0)
const DRY = process.argv.includes('--dry')

/** PNG dimensions live in the IHDR chunk, at a fixed offset. No dependency needed. */
const size = (file) => {
  const b = readFileSync(file)
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), bytes: b.length }
}

for (const name of readdirSync(here).filter((f) => f.endsWith('.png')).sort()) {
  const file = join(here, name)
  const { w, h, bytes } = size(file)
  const ratio = h / w
  // A pixel of rounding is not a reason to re-encode. Without this slack an
  // already-cropped image reports as needing cropping forever, because
  // round(2880 * 0.62) / 2880 is 0.6201, not 0.62.
  if (ratio <= MAX_RATIO + 0.005) {
    console.log(`  keep  ${name.padEnd(32)} ${w}x${h}  ratio ${ratio.toFixed(2)}`)
    continue
  }

  const target = Math.round(w * MAX_RATIO)
  if (DRY) {
    console.log(`  CROP  ${name.padEnd(32)} ${w}x${h} -> ${w}x${target}`)
    continue
  }

  const tmp = join(here, `_${name}`)
  execFileSync('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', file,
    '-vf', `crop=${w}:${target}:0:0`,
    tmp,
  ])
  unlinkSync(file)
  renameSync(tmp, file)
  const after = size(file)
  console.log(
    `  crop  ${name.padEnd(32)} ${w}x${h} -> ${after.w}x${after.h}` +
      `  ${(bytes / 1024).toFixed(0)}KB -> ${(after.bytes / 1024).toFixed(0)}KB`,
  )
}
