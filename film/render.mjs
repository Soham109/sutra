// Render film/index.html to a numbered PNG sequence.
//
// The film is deterministic on purpose: window.FILM.seek(t) paints the exact
// state for time t with no transitions and no CSS animation. So this does not
// "record" anything — it asks for frame n, waits for the paint, and saves it.
// Nothing can drop a frame, stutter under load, or drift out of sync with the
// narration, which is the whole reason for building it this way rather than
// screen-recording a page that animates itself.
//
//   node film/render.mjs [--fps 30] [--scale 1] [--from 0] [--to <ms>]

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import puppeteer from 'puppeteer-core'

const here = dirname(fileURLToPath(import.meta.url))
const OUT = join(here, 'build', 'frames')

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => existsSync(p))

if (!CHROME) {
  console.error('No Chrome or Edge found. Install one, or edit the CHROME list.')
  process.exit(1)
}

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : Number(process.argv[i + 1])
}

const FPS = arg('fps', 30)
const SCALE = arg('scale', 1)
const WIDTH = 1920
const HEIGHT = 1080

const film = pathToFileURL(resolve(here, 'index.html')).href

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  defaultViewport: { width: WIDTH, height: HEIGHT, deviceScaleFactor: SCALE },
  args: [
    '--hide-scrollbars',
    '--force-device-scale-factor=' + SCALE,
    // Deterministic text rendering across machines.
    '--font-render-hinting=none',
    '--disable-lcd-text',
    '--disable-gpu',
  ],
})

const page = await browser.newPage()
page.on('pageerror', (e) => console.error('  page error:', e.message))
await page.goto(film, { waitUntil: 'networkidle0' })

await page.waitForFunction('window.FILM && typeof window.FILM.seek === "function"', { timeout: 20_000 })

const duration = arg('to', await page.evaluate('window.FILM.durationMs'))
const from = arg('from', 0)
if (!Number.isFinite(duration) || duration <= 0) {
  console.error('FILM.durationMs is not a positive number:', duration)
  process.exit(1)
}

const total = Math.ceil(((duration - from) / 1000) * FPS)
console.log(`film: ${(duration / 1000).toFixed(1)}s · ${FPS}fps · ${WIDTH}x${HEIGHT}@${SCALE}x → ${total} frames`)

const started = Date.now()
for (let n = 0; n < total; n++) {
  const t = from + (n / FPS) * 1000
  await page.evaluate((ms) => window.FILM.seek(ms), t)
  // One rAF is enough: seek() is synchronous and nothing animates on its own.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())))
  await page.screenshot({
    path: join(OUT, `f${String(n).padStart(6, '0')}.png`),
    optimizeForSpeed: true,
  })

  if (n % 100 === 0 || n === total - 1) {
    const done = n + 1
    const rate = done / ((Date.now() - started) / 1000)
    const left = (total - done) / rate
    process.stdout.write(
      `\r  ${done}/${total} frames · ${rate.toFixed(1)}/s · ~${Math.max(0, left).toFixed(0)}s left   `,
    )
  }
}

writeFileSync(join(here, 'build', 'frames.json'), JSON.stringify({ fps: FPS, total, duration }, null, 2))
console.log(`\ndone in ${((Date.now() - started) / 1000).toFixed(0)}s`)

await browser.close()
