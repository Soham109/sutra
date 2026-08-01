/* sutra — popup.
 *
 * Shows what the detector found on the active tab, with its confidence and
 * where each number came from, lets you correct it, then asks the service
 * worker to create the group and renders one QR per person.
 *
 * No page code runs here and no page can read this. The API token lives in
 * chrome.storage.sync and only ever leaves via the service worker.
 */

const $ = (s, r = document) => r.querySelector(s)
const bd = $('#bd')

const send = (msg) =>
  new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (r) => {
      const err = chrome.runtime.lastError
      if (err) return reject(new Error(err.message))
      if (!r) return reject(new Error('the sutra service worker did not respond'))
      if (!r.ok) return reject(new Error(r.error))
      resolve(r.data)
    })
  })

const SYMBOL = {
  USD: '$', EUR: '€', GBP: '£', INR: '₹', JPY: '¥', KRW: '₩', CAD: 'CA$', AUD: 'A$',
  NZD: 'NZ$', SGD: 'S$', HKD: 'HK$', BRL: 'R$', MXN: 'MX$', ZAR: 'R', THB: '฿',
  PHP: '₱', TRY: '₺', ILS: '₪', VND: '₫',
}
const ZERO_DEC = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'XAF', 'XOF'])
const exp = (c) => (ZERO_DEC.has(c) ? 0 : 2)
const fmt = (minor, cur) =>
  minor == null ? '—' : (SYMBOL[cur] || cur + ' ') +
    (minor / 10 ** exp(cur)).toFixed(exp(cur)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
const toMinor = (major, cur) => {
  const n = Number(String(major).replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? Math.round(n * 10 ** exp(cur)) : 0
}
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const STRATEGY_LABEL = {
  'shopify-cart': 'your live cart', 'json-ld': 'json-ld', 'shopify-meta': 'shopify',
  microdata: 'microdata', og: 'opengraph', 'dom-total': 'page text', selection: 'your selection',
}

let CONFIG = null
let DETECTION = null

$('#settings-toggle').addEventListener('click', () => renderSettings())
$('#onpage').addEventListener('click', async () => {
  try {
    await send({ type: 'mount' })
    window.close()
  } catch (e) {
    fail(e.message)
  }
})

function fail(msg) {
  const box = document.createElement('div')
  box.className = 'err'
  box.textContent = msg
  bd.appendChild(box)
}

// ---------------------------------------------------------------------

;(async () => {
  try {
    CONFIG = await send({ type: 'config' })
  } catch (e) {
    CONFIG = { engine: 'http://localhost:4100', token: '', members: ['You', 'Friend 1'], policy: 'all_of', deadlineMinutes: 60 }
  }
  try {
    DETECTION = await send({ type: 'detect' })
    renderReview()
  } catch (e) {
    bd.innerHTML = `<div class="err">${esc(e.message)}</div>`
    const b = document.createElement('button')
    b.className = 'cta alt'
    b.textContent = 'Open settings'
    b.addEventListener('click', renderSettings)
    bd.appendChild(b)
  }
})()

// ---------------------------------------------------------------------

function renderReview() {
  const det = DETECTION
  const conf = det.confidence
  const cls = conf >= 0.75 ? 'hi' : conf >= 0.5 ? 'md' : 'lo'
  const word = conf >= 0.85 ? 'high confidence' : conf >= 0.6 ? 'good confidence' : conf >= 0.35 ? 'low confidence' : 'guess'
  const cur = det.currency || 'USD'
  const unit = det.items[0] ? det.items[0].unit_amount : det.total_minor || 0
  const qty = det.items[0] ? det.items[0].qty : 1
  const members = CONFIG.members && CONFIG.members.length ? CONFIG.members : ['You', 'Friend 1']

  let sub = det.merchant.name
  if (det.event && det.event.start) {
    const d = new Date(det.event.start)
    if (!isNaN(d)) sub += ' · ' + d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  }
  if (det.event && det.event.venue) sub += ' · ' + det.event.venue

  const nothing = det.total_minor == null

  bd.innerHTML = `
    <div class="card">
      ${det.image ? `<img src="${esc(det.image)}" alt="">` : ''}
      <div class="t">
        <div class="ttl">${esc(det.title)}</div>
        <div class="mut" style="margin-top:2px">${esc(sub)}</div>
        <div class="chips">
          <span class="chip ${cls}">${word} · ${Math.round(conf * 100)}%</span>
          ${det.strategy.map((s) => `<span class="chip">${esc(STRATEGY_LABEL[s] || s)}</span>`).join('')}
        </div>
      </div>
    </div>
    ${nothing ? `<div class="warn"><div>Nothing on this page looked like a price. Highlight the amount you mean and reopen sutra, or just type it below.</div></div>` : ''}
    ${det.warnings.length ? `<div class="warn">${det.warnings.slice(0, 4).map((w) => `<div>${esc(w)}</div>`).join('')}</div>` : ''}

    <label>What are you splitting</label>
    <input id="title" maxlength="140" value="${esc(det.title)}">

    <label>Price each · quantity</label>
    <div class="row">
      <input id="cur" class="cur" maxlength="3" value="${esc(cur)}">
      <input id="price" inputmode="decimal" value="${(unit / 10 ** exp(cur)).toFixed(exp(cur))}">
      <input id="qty" class="qty" type="number" min="1" max="99" value="${qty}">
    </div>
    ${det.items.length > 1 ? `<div class="mut" style="margin-top:6px">${det.items.length} lines detected, totalling ${fmt(det.total_minor, cur)}. Editing above collapses them into one line.</div>` : ''}

    <label>Who is paying</label>
    <div class="people"></div>
    <button class="add">+ add someone</button>

    <details>
      <summary>Policy and deadline</summary>
      <label>Approval policy</label>
      <select id="policy">
        <option value="all_of">Everyone must approve</option>
        <option value="quorum">Quorum — most of us is enough</option>
        <option value="deadline">Deadline — whoever is in by then</option>
      </select>
      <label>Deadline (minutes)</label>
      <input id="deadline" type="number" min="1" max="10080" value="${CONFIG.deadlineMinutes}">
    </details>

    <div class="sum">
      <div class="l"><span>Total</span><b id="total">—</b></div>
      <div class="l"><span>Each</span><span id="each"></span></div>
    </div>
    <button class="cta" id="go">Request payment</button>
    <div id="err"></div>
    <div class="foot">
      Each person approves their own share — capped at that share, locked to ${esc(det.merchant.domain)}, expiring at the deadline.
      The cap is enforced at the card network, not by this page.
      ${det.provenance.total_minor ? `Amount read from <b>${esc(det.provenance.total_minor)}</b>.` : ''}
    </div>`

  $('#policy').value = CONFIG.policy || 'all_of'

  const people = $('.people')
  const addPerson = (name) => {
    const row = document.createElement('div')
    row.className = 'person'
    const input = document.createElement('input')
    input.value = name
    input.maxLength = 60
    input.placeholder = 'Name'
    input.addEventListener('input', update)
    const rm = document.createElement('button')
    rm.textContent = '−'
    rm.title = 'Remove'
    rm.addEventListener('click', () => { if (people.children.length > 1) { row.remove(); update() } })
    row.append(input, rm)
    people.appendChild(row)
  }
  members.forEach(addPerson)
  $('.add').addEventListener('click', () => {
    if (people.children.length < 20) { addPerson('Friend ' + people.children.length); update() }
  })

  const names = () => [...people.children].map((r) => r.firstChild.value.trim()).filter(Boolean)
  const currency = () => ($('#cur').value || 'USD').toUpperCase().slice(0, 3)
  const total = () => toMinor($('#price').value, currency()) * Math.max(1, Number($('#qty').value) || 1)

  function update() {
    const c = currency()
    const n = Math.max(1, names().length)
    $('#total').textContent = fmt(total(), c)
    $('#each').textContent = fmt(Math.floor(total() / n), c) + ' × ' + n
    $('#go').textContent = `Request payment from ${n} ${n === 1 ? 'person' : 'people'}`
  }
  ;['#title', '#cur', '#price', '#qty'].forEach((s) => $(s).addEventListener('input', update))
  update()

  $('#go').addEventListener('click', async () => {
    const c = currency()
    const unitNow = toMinor($('#price').value, c)
    const who = names()
    const errBox = $('#err')
    errBox.innerHTML = ''
    if (unitNow <= 0) return (errBox.innerHTML = '<div class="err">Set a price above zero. Nothing is sent until you do.</div>')
    if (!who.length) return (errBox.innerHTML = '<div class="err">Add at least one person.</div>')
    if (!/^[A-Z]{3}$/.test(c)) return (errBox.innerHTML = '<div class="err">Currency must be a 3-letter ISO code like USD or INR.</div>')
    if (!CONFIG.engine) { renderSettings(); return }

    const btn = $('#go')
    btn.disabled = true
    btn.textContent = 'Creating mandates…'

    const deadline = Math.max(1, Number($('#deadline').value) || 60)
    const policyKind = $('#policy').value
    const quorum = Math.max(1, Math.ceil(who.length * 0.6))
    const policy =
      policyKind === 'quorum'
        ? { type: 'quorum', m: quorum }
        : policyKind === 'deadline'
          ? { type: 'deadline', at: new Date(Date.now() + deadline * 60000).toISOString(), primary: { type: 'all_of' }, fallback: { type: 'quorum', m: quorum } }
          : { type: 'all_of' }

    try {
      CONFIG = await send({ type: 'save-config', patch: { members: who, policy: policyKind, deadlineMinutes: deadline } })
      const group = await send({
        type: 'create',
        engine: CONFIG.engine,
        token: CONFIG.token,
        group: {
          title: ($('#title').value || det.title || 'Group purchase').slice(0, 140),
          merchant: {
            id: 'sutra-extension',
            name: (det.merchant.name || det.merchant.domain || 'Merchant').slice(0, 80),
            url: /^https?:\/\//.test(det.merchant.url) ? det.merchant.url : 'https://' + det.merchant.domain,
            country_code_iso2: (navigator.language || 'en-US').split('-')[1] || 'US',
          },
          cart: {
            items: [{
              sku: 'sutra-ext-1',
              name: ($('#title').value || 'Item').slice(0, 100),
              unit_amount: unitNow,
              qty: Math.max(1, Number($('#qty').value) || 1),
              claimants: ['mi_all'],
            }],
            fees: [],
            currency: c,
          },
          members: who.slice(0, 20).map((n) => ({ name: n.slice(0, 60), role: 'payer' })),
          policy,
          deadline_minutes: Math.min(10080, deadline),
        },
      })
      renderDone(group, c)
    } catch (e) {
      btn.disabled = false
      update()
      errBox.innerHTML = `<div class="err">${esc(e.message)}</div>`
    }
  })
}

// ---------------------------------------------------------------------

function renderDone(group, cur) {
  const base = String(CONFIG.engine).replace(/\/+$/, '')
  bd.innerHTML = `
    <div class="card"><div class="t">
      <div class="ttl">✓ ${group.members.length} mandates requested</div>
      <div class="mut" style="margin-top:3px">Show each person their code. They approve their own share — you cannot approve for them.</div>
    </div></div>
    ${group.members.map((m) => `
      <div class="mem">
        <img src="${base}/v1/members/${esc(m.member_id)}/qr.png" alt="QR for ${esc(m.name)}">
        <div class="t">
          <div class="n">${esc(m.name)}</div>
          <div class="a">${fmt(m.share_amount, cur)}</div>
          <a class="lnk" href="${esc(m.approval_page_url)}" target="_blank" rel="noopener">open →</a>
          <button class="lnk copy" data-url="${esc(m.approval_page_url)}">copy link</button>
        </div>
      </div>`).join('')}
    <a class="cta" href="${esc(group.board_url)}" target="_blank" rel="noopener">Watch the board live →</a>
    <div class="foot">Group ${esc(group.group_id)} · this popup can close, the board keeps running.</div>`

  document.querySelectorAll('.copy').forEach((b) =>
    b.addEventListener('click', () => {
      navigator.clipboard.writeText(b.dataset.url).then(() => {
        b.textContent = 'copied ✓'
        setTimeout(() => (b.textContent = 'copy link'), 1400)
      })
    }))
}

// ---------------------------------------------------------------------

function renderSettings() {
  bd.innerHTML = `
    <label>Engine base URL</label>
    <input id="engine" placeholder="http://localhost:4100" value="${esc(CONFIG.engine || '')}">
    <div class="mut" style="margin-top:5px">Where the GMP/1 engine is running. Locally that is <code>http://localhost:4100</code>.</div>

    <label>API token</label>
    <input id="token" type="password" placeholder="dev-token" value="${esc(CONFIG.token || '')}">
    <div class="mut" style="margin-top:5px">Sent as <code>Authorization: Bearer …</code>. Matches <code>ENGINE_API_TOKEN</code> in the engine's .env.</div>

    <button class="cta" id="save">Save</button>
    <button class="cta alt" id="back">Back</button>
    <div id="err"></div>
    <div class="foot">Stored in chrome.storage.sync. Never injected into any page — the engine call is made by the extension's service worker.</div>`

  $('#save').addEventListener('click', async () => {
    try {
      CONFIG = await send({
        type: 'save-config',
        patch: { engine: $('#engine').value.trim().replace(/\/+$/, ''), token: $('#token').value },
      })
      if (DETECTION) renderReview()
      else location.reload()
    } catch (e) {
      $('#err').innerHTML = `<div class="err">${esc(e.message)}</div>`
    }
  })
  $('#back').addEventListener('click', () => {
    if (DETECTION) renderReview()
    else location.reload()
  })
}
