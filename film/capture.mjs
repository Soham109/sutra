// Real captures of the live product for the film's Ken-Burns beats.
//
// Screenshots ONLY — this does not touch the film engine, render no frames,
// runs no ffmpeg. Output is high-res PNGs the deterministic FILM.seek(t)
// engine later pans/zooms over.
//
// Credentials are NEVER hardcoded here. Set them as environment variables
// before running (see film/BUILD.md):
//
//   SUTRA_DEMO_EMAIL=you@example.com SUTRA_DEMO_PASSWORD=... node film/capture.mjs
//
// On Windows PowerShell:
//   $env:SUTRA_DEMO_EMAIL="..."; $env:SUTRA_DEMO_PASSWORD="..."; node film/capture.mjs
//
//   node film/capture.mjs [--only receipt,nanda,dashboard,discover,plan,thread,bill]
//   node film/capture.mjs --base https://sutra-gmp.vercel.app

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const here = dirname(fileURLToPath(import.meta.url))
const OUT = join(here, 'assets', 'real')
mkdirSync(OUT, { recursive: true })

const CHROME = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean).find((p) => existsSync(p))

if (!CHROME) {
  console.error('No Chrome or Edge found. Install one or set CHROME_PATH.')
  process.exit(1)
}

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}
const BASE = arg('base', 'https://sutra-gmp.vercel.app').replace(/\/$/, '')
const ONLY = (arg('only', '') || '').split(',').map((s) => s.trim()).filter(Boolean)
const want = (name) => ONLY.length === 0 || ONLY.includes(name)

const EMAIL = process.env.SUTRA_DEMO_EMAIL
const PASSWORD = process.env.SUTRA_DEMO_PASSWORD

const results = {}
const fail = (name, reason) => {
  results[name] = { ok: false, reason: String(reason) }
  console.error(`  [FAIL] ${name}: ${reason}`)
}
const ok = (name, file, note) => {
  results[name] = { ok: true, file, note }
  console.log(`  [OK]   ${name} -> ${file}${note ? '  (' + note + ')' : ''}`)
}

const settle = (ms) => new Promise((r) => setTimeout(r, ms))

async function shoot(page, name, { fullPage = true } = {}) {
  const file = join(OUT, `${name}.png`)
  await page.screenshot({ path: file, fullPage })
  return file
}

// domcontentloaded + a short settle beats networkidle0, which has hung
// before on pages that keep a connection open (websockets, polling). We
// don't need "network idle" — we need "painted", so we settle explicitly.
async function goto(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
  await settle(1400)
}

async function main() {
  console.log(`film capture: ${BASE}`)
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 2 },
    args: ['--hide-scrollbars', '--force-device-scale-factor=2', '--disable-gpu'],
  })

  try {
    // -- 1. public /nanda -----------------------------------------------------
    if (want('nanda')) {
      const page = await browser.newPage()
      try {
        await goto(page, `${BASE}/nanda`)
        await settle(600)
        const file = await shoot(page, 'nanda')
        ok('nanda', file)
      } catch (e) { fail('nanda', e.message) }
      await page.close()
    }

    // -- everything else needs a login (this build gates /receipt behind an
    // account too — "Opening your receipts, you just need an account first" —
    // so receipt capture moved below, authenticated, alongside the rest). ---
    const needsAuth = ['receipt', 'dashboard', 'discover', 'plan', 'thread', 'bill'].some(want)
    if (!needsAuth) { await browser.close(); return summarize() }

    if (!EMAIL || !PASSWORD) {
      for (const n of ['receipt', 'dashboard', 'discover', 'plan', 'thread', 'bill']) {
        if (want(n)) fail(n, 'SUTRA_DEMO_EMAIL / SUTRA_DEMO_PASSWORD not set in the environment')
      }
      await browser.close()
      return summarize()
    }

    const page = await browser.newPage()
    let loggedIn = false
    try {
      // /app itself defaults the embedded auth form to login mode (some
      // other /app/* routes default to register mode instead).
      await goto(page, `${BASE}/app`)
      await page.waitForSelector('input[type="email"]', { timeout: 15_000 })
      await page.type('input[type="email"]', EMAIL, { delay: 12 })
      await page.type('input[type="password"]', PASSWORD, { delay: 12 })
      const clicked = await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button')).find((b) => /^Log in$/i.test(b.textContent.trim()))
        if (!btn) return false
        btn.click()
        return true
      })
      if (!clicked) throw new Error('could not find the "Log in" button')
      // The form re-renders in place (no URL change) once session is set.
      await page.waitForSelector('.crumbs .here', { timeout: 20_000 })
      await settle(1200)
      loggedIn = true
    } catch (e) {
      for (const n of ['receipt', 'dashboard', 'discover', 'plan', 'thread', 'bill']) {
        if (want(n)) fail(n, `login failed: ${e.message}`)
      }
    }

    // The very first /app fetch right after the session cookie is set
    // sometimes races the backend and shows "Couldn't load your dashboard" —
    // a plain reload (a fresh navigation, not an SPA transition) clears it.
    async function ensureDashboardLoaded() {
      for (let attempt = 0; attempt < 3; attempt++) {
        await goto(page, `${BASE}/app`)
        await settle(1000)
        const broken = await page.evaluate(() =>
          /Couldn.?t load your dashboard/i.test(document.body.textContent || ''))
        if (!broken) return true
        console.log(`  (dashboard load error, retrying: attempt ${attempt + 1})`)
        await settle(1200)
      }
      return false
    }

    if (loggedIn) {
      const dashboardOk = await ensureDashboardLoaded()

      // -- receipt, authenticated: the group id embedded in the app as the
      // canonical "signed example" is the same ₹18,600 receipt the task
      // fetches over the API, so this is a direct, reliable route to it. ---
      if (want('receipt')) {
        try {
          if (!dashboardOk) throw new Error('dashboard never loaded past "Couldn\'t load your dashboard"')
          await goto(page, `${BASE}/app/receipts/gs_01KZ1SW0EXN2V3N4Y1V0K5E4H4`)
          await settle(1400)
          const file = await shoot(page, 'receipt')
          ok('receipt', file)
        } catch (e) { fail('receipt', e.message) }
      }

      // -- dashboard ------------------------------------------------------------
      if (want('dashboard')) {
        try {
          if (!dashboardOk) throw new Error('"Couldn\'t load your dashboard" persisted after 3 reloads')
          await goto(page, `${BASE}/app`)
          await settle(1000)
          const file = await shoot(page, 'dashboard')
          ok('dashboard', file)
        } catch (e) { fail('dashboard', e.message) }
      }

      // -- 4. discover ----------------------------------------------------------
      if (want('discover')) {
        try {
          await goto(page, `${BASE}/app/discover`)
          await settle(900)
          const file = await shoot(page, 'discover')
          ok('discover', file)
        } catch (e) { fail('discover', e.message) }
      }

      // -- 5. the seeded plan, found from the dashboard's "waiting" list ------
      if (want('plan')) {
        try {
          if (!dashboardOk) throw new Error('dashboard never loaded past "Couldn\'t load your dashboard"')
          await goto(page, `${BASE}/app`)
          await settle(1000)
          const candidates = await page.evaluate(() => {
            const rows = Array.from(document.querySelectorAll('a.waiting-row, a.need-card, a[href*="/app/plans/"]'))
            return rows.map((a) => ({ href: a.getAttribute('href'), text: (a.textContent || '').trim().slice(0, 120) }))
          })
          console.log('  plan candidates:', JSON.stringify(candidates))
          let hit = candidates.find((c) => (c.href || '').includes('/app/plans/') && /indiranagar|dinner|koramangala/i.test(c.text))
          if (!hit) hit = candidates.find((c) => (c.href || '').includes('/app/plans/'))
          if (!hit) throw new Error(`no /app/plans/ link found on the dashboard. candidates: ${JSON.stringify(candidates)}`)
          await goto(page, hit.href.startsWith('http') ? hit.href : `${BASE}${hit.href}`)
          await settle(1500)
          const file = await shoot(page, 'plan')
          ok('plan', file, hit.href)
        } catch (e) { fail('plan', e.message) }
      }

      // -- 6. a group thread with an @sutra reply --------------------------
      if (want('thread')) {
        try {
          await goto(page, `${BASE}/app/groups`)
          await settle(900)
          const groupHrefs = await page.evaluate(() =>
            Array.from(document.querySelectorAll('a.gr-row')).map((a) => a.getAttribute('href')))
          if (groupHrefs.length === 0) throw new Error('no groups listed at /app/groups')

          let captured = false
          for (const href of groupHrefs) {
            await goto(page, href.startsWith('http') ? href : `${BASE}${href}`)
            await settle(900)
            const hasBotReply = await page.evaluate(() =>
              document.querySelectorAll('.chat-row-bot').length > 0)
            if (hasBotReply) {
              const file = await shoot(page, 'thread')
              ok('thread', file, href)
              captured = true
              break
            }
          }
          if (!captured) throw new Error('no group had an existing @sutra reply in its thread')
        } catch (e) { fail('thread', e.message) }
      }

      // -- 7. /app/bill after pasting a bill -----------------------------------
      if (want('bill')) {
        try {
          await goto(page, `${BASE}/app/bill`)
          const textareaSel = 'textarea.input.bill-text, textarea.bill-text, textarea[placeholder*="Margherita" i]'
          await page.waitForSelector(textareaSel, { timeout: 15_000 })
          const sample = [
            '2x Margherita Pizza      480',
            '1x Paneer Tikka          380',
            '3x Masala Dosa           540',
            '2x Cold Coffee           240',
            'Subtotal                1640',
            'GST @5%                   82',
            'Total                   1722',
          ].join('\n')
          await page.click(textareaSel)
          await page.type(textareaSel, sample, { delay: 4 })
          // React controlled inputs need a real 'input' event, which page.type
          // fires per keystroke — give it a beat to update disabled state.
          await settle(400)
          const state = await page.evaluate(() => {
            const btn = Array.from(document.querySelectorAll('button')).find((b) => /read the bill/i.test(b.textContent || ''))
            return btn ? { found: true, disabled: btn.disabled, text: btn.textContent } : { found: false }
          })
          console.log('  bill parse button state:', JSON.stringify(state))
          if (!state.found) throw new Error('"Read the bill" button not found in DOM')
          if (state.disabled) throw new Error(`"Read the bill" button present but disabled (text="${state.text}")`)
          await page.evaluate(() => {
            Array.from(document.querySelectorAll('button')).find((b) => /read the bill/i.test(b.textContent || '')).click()
          })
          await settle(2600)
          const file = await shoot(page, 'bill')
          ok('bill', file)
        } catch (e) { fail('bill', e.message) }
      }
    }
    await page.close()
  } finally {
    await browser.close()
  }
  summarize()
}

function summarize() {
  writeFileSync(join(OUT, 'capture-report.json'), JSON.stringify(results, null, 2))
  const okCount = Object.values(results).filter((r) => r.ok).length
  const total = Object.keys(results).length
  console.log(`\n${okCount}/${total} captures ok. Report: ${join(OUT, 'capture-report.json')}`)
  const failed = Object.entries(results).filter(([, r]) => !r.ok)
  if (failed.length) {
    console.log('Failed (animate these beats instead of using a real capture):')
    for (const [name, r] of failed) console.log(`  - ${name}: ${r.reason}`)
  }
}

await main()
