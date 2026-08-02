// Real screenshots of the real product.
//
// This registers a throwaway account against a live sutra deployment, uses
// the actual UI to create a bill split and a link split with real (bare-name)
// friends, approves some shares and leaves others pending, settles one group,
// and screenshots every screen along the way — plus the landing page, /nanda,
// and (best-effort) a plan board with real venues. Nothing here is staged:
// every number on screen came out of a real request to the engine.
//
// Regenerate with:
//   node docs/screenshots/capture.mjs
//
// Point at a different deployment with SUTRA_URL. Defaults to production.

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import sharp from 'sharp'

const here = dirname(fileURLToPath(import.meta.url))
const OUT = here
const BASE = process.env.SUTRA_URL ?? 'https://sutra-gmp.vercel.app'
const MAX_BYTES = 600 * 1024

const CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  process.env.CHROME_PATH,
].filter(Boolean).find((p) => existsSync(p))

if (!CHROME) {
  console.error('No Chrome or Edge found. Install one, or edit the CHROME list.')
  process.exit(1)
}

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true })

// A plausible throwaway identity — unique per run so re-running never
// collides with a previous demo account.
const RUN_ID = Date.now().toString().slice(-6)
const ME = {
  name: 'Rohan Desai',
  handle: `rohandesai${RUN_ID}`,
  email: `rohan.desai.${RUN_ID}@example.com`,
  password: 'sutra-demo-passphrase-2026',
}

const FRIENDS_LINK = ['Priya Nair', 'Ishaan Kapoor']
const FRIENDS_BILL = ['Arjun Mehta', 'Kavya Menon']

const BILL_TEXT = `Toit, Indiranagar
2x Margherita Pizza ......... ₹560
Paneer Tikka ................. ₹380
3x Masala Chai ................ ₹240
Service Charge .................. ₹98
Total ......................... ₹1278`

const findings = []
const note = (msg) => {
  console.log(`  ! ${msg}`)
  findings.push(msg)
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

// ---------------------------------------------------------------------------
// Small DOM helpers. The app is a real React SPA with no test ids, so these
// drive it the way a person would: find visible text, click it, type into it.
// ---------------------------------------------------------------------------

// Case-insensitive: several labels ("Your share", "Bring everyone in") are
// styled with CSS text-transform: uppercase, and `innerText` reflects the
// rendered (transformed) text, not the source string — a case-sensitive
// match against the literal copy silently never fires.
async function waitForText(page, text, timeout = 20_000) {
  await page.waitForFunction(
    (t) => document.body.innerText.toLowerCase().includes(t.toLowerCase()),
    { timeout },
    text,
  )
}

async function textPresent(page, text) {
  return page.evaluate((t) => document.body.innerText.toLowerCase().includes(t.toLowerCase()), text)
}

/** Finds the first clickable element whose own text includes `text`, clicks it. */
async function clickText(page, text, { timeout = 15_000 } = {}) {
  await page.waitForFunction(
    (t) => {
      const els = Array.from(document.querySelectorAll('button, a'))
      const hit = els.find((el) => (el.textContent ?? '').trim().includes(t) && el.offsetParent !== null)
      if (hit) {
        hit.setAttribute('data-capture-hit', '1')
        return true
      }
      return false
    },
    { timeout },
    text,
  )
  const handle = await page.$('[data-capture-hit="1"]')
  if (!handle) throw new Error(`clickText: lost element for "${text}"`)
  await handle.evaluate((el) => el.removeAttribute('data-capture-hit'))
  await handle.click()
  return handle
}

/** Clicks into a field (by placeholder or aria-label) and types like a person. */
async function typeInto(page, selector, text, { timeout = 15_000, delay = 3 } = {}) {
  const el = await page.waitForSelector(selector, { timeout, visible: true })
  await el.click({ clickCount: 3 })
  await page.keyboard.type(text, { delay })
  return el
}

async function setTheme(page, theme) {
  await page.evaluateOnNewDocument((t) => {
    try {
      window.localStorage.setItem('sutra-theme', t)
    } catch {
      /* ignore */
    }
  }, theme)
}

// ---------------------------------------------------------------------------
// Screenshot capture with a size budget. Full-page PNGs at 2x can blow past
// 600KB fast, so anything over budget gets palette-quantised and, if it's
// still too big, progressively downscaled — never re-cropped or re-drawn.
// ---------------------------------------------------------------------------

async function shrinkToBudget(buf, limitBytes) {
  if (buf.length <= limitBytes) return buf
  let quality = 90
  let scale = 1
  let out = buf
  for (let i = 0; i < 8; i++) {
    const meta = await sharp(buf).metadata()
    const width = Math.max(480, Math.round(meta.width * scale))
    out = await sharp(buf).resize({ width }).png({ palette: true, quality, compressionLevel: 9 }).toBuffer()
    if (out.length <= limitBytes) return out
    if (quality > 40) quality -= 15
    else scale *= 0.85
  }
  return out
}

/**
 * Fit a whole page into one frame of a given shape by zooming out.
 *
 * A full-page capture of the dashboard is 2,300+ CSS pixels tall. Cropping it
 * to a readable shape throws away the exposure meter and the charts — the
 * parts that answer "what is this product for" — and leaving it uncropped
 * gives a README a column you scroll past rather than an image you read.
 *
 * So: shrink the page until it fits, rather than cutting it. Everything stays
 * visible and stays real; it is simply further away. At deviceScaleFactor 2
 * there is enough resolution in hand that a 0.7 zoom still renders crisply.
 */
async function fitZoom(page, ratio) {
  const vp = page.viewport()
  const frameHeight = Math.round(vp.width * ratio)
  await page.evaluate(() => { document.body.style.zoom = '1' })
  const content = await page.evaluate(() => document.documentElement.scrollHeight)
  // Never zoom IN, and never below 0.55 — past that the type stops being
  // legible and a screenshot nobody can read is worth nothing.
  const zoom = Math.max(0.55, Math.min(1, frameHeight / content))
  await page.evaluate((z) => { document.body.style.zoom = String(z) }, zoom)
  await sleep(250)
  await page.setViewport({ ...vp, height: frameHeight })
  await sleep(250)
  return { vp, zoom }
}

async function shot(page, name, { fullPage = true, fit = 0 } = {}) {
  let buf
  if (fit) {
    const { vp, zoom } = await fitZoom(page, fit)
    buf = await page.screenshot({ type: 'png' })
    await page.evaluate(() => { document.body.style.zoom = '1' })
    await page.setViewport(vp)
    console.log(`  (fitted at ${(zoom * 100).toFixed(0)}% zoom)`)
  } else if (fullPage) {
    // Not `page.screenshot({ fullPage: true })`: Chrome's beyond-viewport
    // capture composites a page taller than the viewport without actually
    // reflowing it, which leaves `position: fixed`/`sticky` chrome (the
    // sidebar, the topbar) painted at its last scroll position instead of
    // pinned — a duplicate sidebar floating mid-page. Actually resizing the
    // viewport to the full content height forces a real reflow, so fixed
    // elements compute correctly, then a normal screenshot covers everything.
    const vp = page.viewport()
    const contentHeight = await page.evaluate(() => document.documentElement.scrollHeight)
    const targetHeight = Math.max(vp.height, Math.ceil(contentHeight))
    await page.setViewport({ ...vp, height: targetHeight })
    await sleep(200)
    buf = await page.screenshot({ type: 'png' })
    await page.setViewport(vp)
  } else {
    buf = await page.screenshot({ type: 'png' })
  }
  const final = await shrinkToBudget(buf, MAX_BYTES)
  writeFileSync(join(OUT, name), final)
  console.log(`  saved ${name} (${(final.length / 1024).toFixed(0)} KB)`)
}

// ---------------------------------------------------------------------------

async function fetchGroup(page, groupId) {
  return page.evaluate(async (gid) => {
    const res = await fetch(`/api/v1/groups/${gid}`, { credentials: 'include' })
    return res.json()
  }, groupId)
}

async function approveMember(page, memberId, { atVenue = true } = {}) {
  await page.goto(`${BASE}/a/${memberId}`, { waitUntil: 'networkidle2', timeout: 45_000 })
  const label = atVenue ? "That's right" : 'Approve'
  await waitForText(page, label, 15_000)
  await clickText(page, label)
  // "Your share" is shown both before and after accepting, so it is not a
  // valid confirmation signal. The one reliable tell that the server-side
  // status actually changed is that this exact button unmounts.
  await page
    .waitForFunction(
      (t) => !Array.from(document.querySelectorAll('button')).some((b) => (b.textContent ?? '').includes(t)),
      { timeout: 15_000 },
      label,
    )
    .catch(async () => {
      const bodyText = await page.evaluate(() => document.body.innerText).catch(() => '')
      note(
        `approveMember(${memberId}): the accept button was still there after clicking. Page said: ${bodyText.slice(0, 400).replace(/\n+/g, ' | ')}`,
      )
    })
}

async function main() {
  console.log(`sutra screenshots · ${BASE}\n`)

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
    args: ['--hide-scrollbars', '--force-device-scale-factor=2', '--font-render-hinting=none', '--disable-lcd-text'],
  })

  const page = await browser.newPage()
  page.on('pageerror', (e) => note(`page error: ${e.message}`))
  await setTheme(page, 'light')

  // --- 1. Landing page, logged out --------------------------------------
  console.log('1/11 landing page (light)')
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle2', timeout: 45_000 })
  await waitForText(page, 'Split it before')
  await sleep(600)
  await shot(page, '01-landing-light.png', { fullPage: false })

  // --- 2. Register a throwaway account ----------------------------------
  console.log('2/11 registering throwaway account')
  await page.goto(`${BASE}/app/discover`, { waitUntil: 'networkidle2', timeout: 45_000 })
  await page.waitForSelector('input[placeholder="you@example.com"]', { timeout: 20_000 })
  await typeInto(page, 'input[placeholder="you@example.com"]', ME.email)
  await typeInto(page, 'input[placeholder="At least 10 characters"]', ME.password)
  await typeInto(page, 'input[placeholder="soham"]', ME.handle)
  await typeInto(page, 'input[placeholder="Soham"]', ME.name)
  await clickText(page, 'Create account')
  await page.waitForSelector('.sidebar', { timeout: 20_000 })
  console.log(`  registered @${ME.handle}`)

  // --- 3. Discover: real search, real results -----------------------------
  console.log('3/11 discover search')
  await typeInto(page, 'input[aria-label="Search for a product, or paste a product link"]', 'merino tee')
  // Not clickText('Search') — the topbar's "Search anything" button (⌘K
  // palette) also matches that substring and sits earlier in the DOM.
  await page.waitForSelector('form.discover-search button[type="submit"]', { timeout: 10_000 })
  await page.click('form.discover-search button[type="submit"]')
  await page.waitForFunction(
    () => /results? for|Nothing came back|did not come back/.test(document.body.innerText),
    { timeout: 25_000 },
  )
  const searchOk = await textPresent(page, 'result')
  if (!searchOk) note('discover search for "merino tee" returned no results')
  await sleep(400)
  await shot(page, '03-discover-search-light.png', { fit: 0.62 })

  // Build a real link-split group from the first result, so the dashboard
  // has a genuine pending mandate to show later.
  let linkGroupId = null
  if (searchOk) {
    try {
      await clickText(page, 'Split this')
      await page.waitForSelector('input[placeholder="What is this group buying?"]', { timeout: 20_000 })
      for (const friend of FRIENDS_LINK) {
        await typeInto(page, 'input[aria-label="Find or add a person"]', friend)
        await page.keyboard.press('Enter')
        await sleep(200)
      }
      await clickText(page, 'Create the group')
      await page.waitForFunction(() => location.pathname.startsWith('/app/groups/'), { timeout: 20_000 })
      linkGroupId = new URL(page.url()).pathname.split('/').pop()
      console.log(`  link-split group created: ${linkGroupId}`)
    } catch (e) {
      note(`could not build the link-split group: ${e.message}`)
    }
  }

  // --- 4. Bill: real receipt, itemised + reconciled -----------------------
  console.log('4/11 bill split')
  await page.goto(`${BASE}/app/bill`, { waitUntil: 'networkidle2', timeout: 45_000 })
  await typeInto(page, 'textarea.bill-text', BILL_TEXT, { delay: 1 })
  await clickText(page, 'Read the bill')
  await page.waitForFunction(
    () => /maths checks out|maths does not close|numbers add up/.test(document.body.innerText),
    { timeout: 15_000 },
  )
  const billBalanced = await textPresent(page, 'maths checks out')
  if (!billBalanced) note('the demo receipt did not reconcile cleanly — check BILL_TEXT against engine/src/bill/parse.ts')
  for (const friend of FRIENDS_BILL) {
    await typeInto(page, '.bill-out input[aria-label="Find or add a person"]', friend)
    await page.keyboard.press('Enter')
    await sleep(200)
  }
  await typeInto(page, 'input[placeholder="Toit, Indiranagar"]', 'Toit, Indiranagar')
  await sleep(300)
  await shot(page, '04-bill-parsed-light.png', { fit: 0.62 })

  let billGroupId = null
  try {
    await clickText(page, 'Send friends their shares')
    await page.waitForFunction(() => location.pathname.startsWith('/app/groups/'), { timeout: 20_000 })
    billGroupId = new URL(page.url()).pathname.split('/').pop()
    console.log(`  bill-split group created: ${billGroupId}`)
  } catch (e) {
    note(`could not create the bill-split group: ${e.message}`)
  }

  // --- 5/6. Approve some shares, leave one pending, capture mid-flight ----
  let arjunPending = null
  if (billGroupId) {
    console.log('5/11 approving my share + one friend, leaving one pending')
    const group = await fetchGroup(page, billGroupId)
    const byName = Object.fromEntries((group.members ?? []).map((m) => [m.name, m.member_id]))
    try {
      if (byName[ME.name]) await approveMember(page, byName[ME.name])
      if (byName['Kavya Menon']) await approveMember(page, byName['Kavya Menon'])
      arjunPending = byName['Arjun Mehta'] ?? null
    } catch (e) {
      note(`approving shares failed: ${e.message}`)
    }

    if (arjunPending) {
      console.log('6/11 member approval page (pending)')
      await page.goto(`${BASE}/a/${arjunPending}`, { waitUntil: 'networkidle2', timeout: 45_000 })
      await waitForText(page, "That's right", 15_000).catch(() => note('approval page for Arjun did not show the accept action'))
      await sleep(300)
      await shot(page, '06-approval-pending-light.png', { fit: 0.62 })
    } else {
      note('no pending member left to screenshot on /a/:memberId')
    }

    console.log('  group page, mid-flight')
    await page.goto(`${BASE}/app/groups/${billGroupId}`, { waitUntil: 'networkidle2', timeout: 45_000 })
    await waitForText(page, group.title ?? 'Split the bill', 15_000).catch(() => {})
    await sleep(400)
    await shot(page, '05-group-midflight-light.png', { fit: 0.62 })
  } else {
    note('no bill-split group — skipped mid-flight group page and pending approval screenshots')
  }

  // --- 7. Dashboard with real data (light) --------------------------------
  console.log('7/11 dashboard (light)')
  await page.goto(`${BASE}/app`, { waitUntil: 'networkidle2', timeout: 45_000 })
  await page.waitForSelector('.home-page', { timeout: 20_000 })
  await sleep(900)
  await shot(page, '02-dashboard-light.png', { fit: 0.62 })

  // --- 8. Settle the bill split, capture the signed receipt ---------------
  if (billGroupId && arjunPending) {
    console.log('8/11 settling the bill split, capturing the receipt')
    try {
      await approveMember(page, arjunPending)
      let settled = false
      for (let i = 0; i < 8 && !settled; i++) {
        const g = await fetchGroup(page, billGroupId)
        settled = g.terminal === true
        if (!settled) await sleep(1000)
      }
      if (!settled) note('bill-split group did not reach a terminal status after every share was accepted')
      await page.goto(`${BASE}/app/receipts/${billGroupId}`, { waitUntil: 'networkidle2', timeout: 45_000 })
      await waitForText(page, 'Signed receipt', 15_000)
      await sleep(400)
      await shot(page, '07-receipt-settled-light.png', { fit: 0.62 })
    } catch (e) {
      note(`could not settle the bill split / capture the receipt: ${e.message}`)
    }
  } else {
    note('skipped the signed-receipt screenshot — no fully-approvable bill-split group')
  }

  // --- 9. /nanda -----------------------------------------------------------
  console.log('9/11 /nanda')
  await page.goto(`${BASE}/nanda`, { waitUntil: 'networkidle2', timeout: 45_000 })
  await waitForText(page, 'answered just now', 20_000).catch(() =>
    note('the /nanda discovery chain did not settle within 20s — captured whatever state it was in'),
  )
  await sleep(500)
  await shot(page, '08-nanda-light.png', { fit: 0.62 })

  // --- 10. Plan board with real venues (best-effort) ------------------------
  console.log('10/11 plan board (best-effort — venue search is known to be unreliable)')
  let planCaptured = false
  try {
    await page.goto(`${BASE}/app/plan/new`, { waitUntil: 'networkidle2', timeout: 45_000 })
    await typeInto(
      page,
      'textarea[aria-label="Plan an idea"]',
      'Dinner tomorrow with Arjun and Kavya near Koramangala, Bangalore, under ₹1000 each',
    )
    await clickText(page, 'Review the plan')
    // Not the literal apostrophe: the source uses a typographic ’ (U+2019),
    // which is what `innerText` actually renders — a straight ' never matches.
    await waitForText(page, 'what I read', 20_000)
    // The extractor already read "Arjun" and "Kavya" as bare-name people
    // straight out of the sentence — no need to add anyone by hand.
    await clickText(page, 'Ask the group')
    await page.waitForFunction(() => location.pathname.startsWith('/app/plans/'), { timeout: 20_000 })

    // A board with zero answers proves venue discovery, but not coordination.
    // Answer every requested question for the three throwaway seats so the
    // screenshot shows the real common-window and ranking arithmetic too.
    // These are ordinary participant-link calls against the live API; no
    // state is injected into React and no displayed number is staged.
    const planId = new URL(page.url()).pathname.split('/').pop()
    const answerResult = await page.evaluate(async (pid) => {
      const get = await fetch(`/api/v1/plans/${pid}`, { credentials: 'include' })
      if (!get.ok) return { ok: false, reason: `plan fetch returned ${get.status}` }
      const plan = await get.json()
      const places = [
        { label: 'Koramangala', lat: 12.9352, lng: 77.6245, source: 'manual' },
        { label: 'Indiranagar', lat: 12.9784, lng: 77.6408, source: 'manual' },
        { label: 'Jayanagar', lat: 12.9141, lng: 77.6101, source: 'manual' },
      ]

      for (const [i, participant] of plan.participants.entries()) {
        if (!participant.participant_id) continue
        const day = new Date(Date.now() + 24 * 60 * 60 * 1000)
        day.setUTCHours(13, i * 15, 0, 0)
        const end = new Date(day)
        end.setUTCHours(17, 30 - i * 15, 0, 0)
        const payloads = {
          rsvp: { kind: 'rsvp', in: true },
          location: { kind: 'location', place: places[i % places.length] },
          availability: {
            kind: 'availability',
            windows: [{ start: day.toISOString(), end: end.toISOString() }],
            anytime: false,
          },
          budget: { kind: 'budget', ceiling_minor: 100000, currency: 'INR' },
          constraint: { kind: 'constraint', text: 'vegetarian options' },
        }
        for (const kind of plan.ask) {
          const payload = payloads[kind]
          if (!payload) continue
          const sent = await fetch(`/api/v1/participants/${participant.participant_id}/signal`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          })
          if (!sent.ok) return { ok: false, reason: `${participant.name}/${kind} returned ${sent.status}` }
        }
      }
      return { ok: true }
    }, planId)
    if (!answerResult.ok) note(`could not populate plan answers: ${answerResult.reason}`)
    await page.reload({ waitUntil: 'networkidle2', timeout: 45_000 })

    // Venue search can take a long time (STATUS.md: up to ~40s) or return
    // nothing at all. Wait generously; do not fabricate a result either way.
    const gotOptions = await page
      .waitForFunction(
        () => {
          const t = document.body.innerText
          return /\d+ options, ranked/.test(t) && !/^0 options/.test(t.match(/\d+ options, ranked[^\n]*/)?.[0] ?? '0 options')
        },
        { timeout: 50_000 },
      )
      .then(() => true)
      .catch(() => false)

    const hasCards = await page.evaluate(() => document.querySelectorAll('.opt-list > *').length > 0)
    if (gotOptions && hasCards) {
      await sleep(400)
      await shot(page, '09-plan-board-light.png', { fit: 0.62 })
      planCaptured = true
      console.log('  plan board populated — captured')
    } else {
      note('plan board returned no ranked venues within 50s — skipped 09-plan-board-light.png rather than fake it')
    }
  } catch (e) {
    note(`plan board flow failed: ${e.message}`)
  }

  // --- 11. Dark theme: dashboard + landing --------------------------------
  console.log('11/11 dark theme (dashboard + landing)')
  const darkPage = await browser.newPage()
  await darkPage.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 })
  await setTheme(darkPage, 'dark')
  await darkPage.goto(`${BASE}/app`, { waitUntil: 'networkidle2', timeout: 45_000 })
  await darkPage.waitForSelector('.home-page', { timeout: 20_000 })
  await sleep(900)
  await shot(darkPage, '10-dashboard-dark.png', { fit: 0.62 })

  await darkPage.goto(`${BASE}/`, { waitUntil: 'networkidle2', timeout: 45_000 })
  await waitForText(darkPage, 'Split it before')
  await sleep(600)
  await shot(darkPage, '11-landing-dark.png', { fullPage: false })

  await browser.close()

  // --- Legacy filenames -----------------------------------------------------
  // README.md links images under short, purpose-named files rather than this
  // script's numbered scheme. Duplicate the ones that exist; a broken link in
  // front of judges is worse than a slightly odd filename. `extension.png`
  // is deliberately never produced here — it needs Chrome running with the
  // unpacked extension loaded against a real merchant page, which this
  // headless flow cannot do honestly. Faking it is worse than omitting it.
  console.log('legacy filenames for README.md')
  const LEGACY = {
    'dashboard.png': '02-dashboard-light.png',
    'discover.png': '03-discover-search-light.png',
    'bill-split.png': '04-bill-parsed-light.png',
    'group-thread.png': '05-group-midflight-light.png',
    'receipt.png': '07-receipt-settled-light.png',
    'plan.png': planCaptured ? '09-plan-board-light.png' : null,
  }
  for (const [legacyName, sourceName] of Object.entries(LEGACY)) {
    const src = sourceName ? join(OUT, sourceName) : null
    if (src && existsSync(src)) {
      copyFileSync(src, join(OUT, legacyName))
      console.log(`  ${legacyName}  <-  ${sourceName}`)
    } else {
      note(`${legacyName} not written — its source (${sourceName ?? 'n/a'}) was not captured this run`)
    }
  }
  note('extension.png not written — capturing the Chrome extension honestly needs a loaded unpacked extension against a real merchant page, out of scope for this headless script')

  console.log('\ndone.\n')
  console.log('Findings:')
  if (findings.length === 0) console.log('  none — every capture went as planned')
  else for (const f of findings) console.log(`  - ${f}`)

  writeFileSync(
    join(OUT, 'run-report.json'),
    JSON.stringify(
      {
        base: BASE,
        at: new Date().toISOString(),
        account: { name: ME.name, handle: ME.handle },
        linkGroupId,
        billGroupId,
        planCaptured,
        findings,
      },
      null,
      2,
    ),
  )
}

main().catch((e) => {
  console.error('\nFATAL:', e)
  process.exit(1)
})
