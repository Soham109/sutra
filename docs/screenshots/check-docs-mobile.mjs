// Does /docs actually survive a narrow phone, and dark mode?
//
// The agent that built the page said plainly that it could not verify this and
// had reasoned about it statically instead. That is the right way to report an
// unverified claim — and the right response is to go and measure it, because a
// page that scrolls sideways on a phone is the kind of thing a judge finds in
// the first ten seconds.
//
//   node docs/screenshots/check-docs-mobile.mjs [url]

import { existsSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => existsSync(p))

const base = process.argv[2] ?? 'http://localhost:3000'
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' })

const widths = [390, 414, 768, 1440]
let bad = 0

for (const scheme of ['light', 'dark']) {
  for (const width of widths) {
    const page = await browser.newPage()
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }])
    await page.setViewport({ width, height: 900, deviceScaleFactor: 1 })
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))

    await page.goto(`${base}/docs`, { waitUntil: 'networkidle0', timeout: 45_000 })

    const r = await page.evaluate(() => {
      const doc = document.documentElement
      // Anything genuinely wider than the viewport is what causes the sideways
      // scroll. Report the widest offender by tag+class so it is actionable.
      let worst = null
      for (const el of document.querySelectorAll('body *')) {
        const box = el.getBoundingClientRect()
        const over = Math.round(box.right - window.innerWidth)
        if (over > 2 && (!worst || over > worst.over)) {
          worst = {
            over,
            tag: el.tagName.toLowerCase(),
            cls: (el.className && String(el.className).slice(0, 48)) || '',
          }
        }
      }
      return {
        scrollW: doc.scrollWidth,
        clientW: doc.clientWidth,
        svgs: document.querySelectorAll('svg').length,
        worst,
      }
    })

    const overflows = r.scrollW > r.clientW + 1
    const flag = overflows || errors.length ? 'FAIL' : 'ok  '
    if (overflows || errors.length) bad++
    console.log(
      `${flag} ${scheme.padEnd(5)} ${String(width).padStart(4)}px  scroll=${r.scrollW} client=${r.clientW} svgs=${r.svgs}` +
        (r.worst ? `  widest: <${r.worst.tag} class="${r.worst.cls}"> +${r.worst.over}px` : '') +
        (errors.length ? `  errors: ${errors[0]}` : ''),
    )
    await page.close()
  }
}

await browser.close()
console.log(bad === 0 ? '\nno horizontal overflow, no page errors' : `\n${bad} problem(s)`)
process.exit(bad === 0 ? 0 : 1)
