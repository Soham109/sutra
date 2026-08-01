/* sutra — on-page sheet, injected on demand by background.js.
 *
 * Runs in the ISOLATED world: it draws UI and reads the DOM, but the actual
 * detection happened in the MAIN world (background.js → detect.js) and the
 * engine call happens in the service worker. Neither the API token nor the
 * engine response ever touches page script.
 *
 * Everything lives in a shadow root so the host page's CSS cannot reach in
 * and this cannot leak out.
 */
;(() => {
  const ID = 'sutra-sheet-root'
  const existing = document.getElementById(ID)
  if (existing) {
    existing.remove() // toggle: a second Alt+Shift+S closes it
    return
  }

  const send = (msg) =>
    new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(msg, (r) => {
        const err = chrome.runtime.lastError
        if (err) return reject(new Error(err.message))
        if (!r) return reject(new Error('no response from the sutra service worker'))
        if (!r.ok) return reject(new Error(r.error))
        resolve(r.data)
      })
    })

  const host = document.createElement('div')
  host.id = ID
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647'
  const root = host.attachShadow({ mode: 'open' })
  document.documentElement.appendChild(host)

  const close = () => host.remove()

  const SYMBOL = {
    USD: '$', EUR: '€', GBP: '£', INR: '₹', JPY: '¥', KRW: '₩', CAD: 'CA$', AUD: 'A$',
    NZD: 'NZ$', SGD: 'S$', HKD: 'HK$', BRL: 'R$', MXN: 'MX$', ZAR: 'R', THB: '฿',
    PHP: '₱', TRY: '₺', ILS: '₪', VND: '₫',
  }
  const ZERO_DEC = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'XAF', 'XOF'])
  const exp = (c) => (ZERO_DEC.has(c) ? 0 : 2)
  const fmt = (minor, cur) =>
    minor === null || minor === undefined
      ? '—'
      : (SYMBOL[cur] || cur + ' ') +
        (minor / 10 ** exp(cur)).toFixed(exp(cur)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const toMinor = (major, cur) => {
    const n = Number(String(major).replace(/[^\d.-]/g, ''))
    return Number.isFinite(n) ? Math.round(n * 10 ** exp(cur)) : 0
  }

  root.innerHTML = `<style>
    :host{all:initial}
    *{box-sizing:border-box;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
    .scrim{position:fixed;inset:0;background:rgba(10,10,12,.62);backdrop-filter:blur(3px);display:flex;align-items:flex-end;justify-content:center}
    @media(min-width:560px){.scrim{align-items:center;padding:24px}}
    .sheet{background:#fbfaf8;color:#14100a;width:100%;max-width:452px;max-height:92vh;overflow:auto;border-radius:18px 18px 0 0;box-shadow:0 24px 70px rgba(0,0,0,.4)}
    @media(min-width:560px){.sheet{border-radius:18px}}
    .hd{display:flex;align-items:center;gap:10px;padding:16px 18px 12px;border-bottom:1px solid #ece8e1;position:sticky;top:0;background:#fbfaf8;z-index:2}
    .hd b{font-size:15px;font-weight:750;flex:1;letter-spacing:-.01em}
    .spark{width:22px;height:22px;border-radius:7px;background:#f59e0b;display:grid;place-items:center;font-size:12px}
    .x{border:0;background:#f0ece5;width:28px;height:28px;border-radius:9px;cursor:pointer;color:#57534e;font-size:15px;line-height:1}
    .bd{padding:16px 18px 20px}
    .card{display:flex;gap:12px;background:#fff;border:1px solid #ece8e1;border-radius:13px;padding:12px}
    .card img{width:56px;height:56px;object-fit:cover;border-radius:9px;background:#f0ece5;flex:none}
    .t{flex:1;min-width:0}
    .ttl{font-weight:700;font-size:14px;line-height:1.35}
    .mut{color:#78716c;font-size:12px}
    .chips{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px}
    .chip{font-size:10.5px;letter-spacing:.04em;text-transform:uppercase;padding:3px 7px;border-radius:6px;background:#f0ece5;color:#57534e;font-weight:650}
    .chip.hi{background:#dcfce7;color:#166534}.chip.md{background:#fef3c7;color:#92400e}.chip.lo{background:#fee2e2;color:#991b1b}
    .warn{margin-top:10px;font-size:12px;line-height:1.5;color:#92400e;background:#fffbeb;border:1px solid #fde68a;border-left:3px solid #f59e0b;border-radius:8px;padding:9px 11px}
    label{display:block;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#a8a29e;margin:16px 0 6px}
    input,select{width:100%;padding:10px 11px;border:1px solid #ddd7cd;border-radius:9px;font-size:14px;background:#fff;color:#14100a}
    input:focus,select:focus{outline:2px solid #f59e0b;outline-offset:-1px}
    .row{display:flex;gap:9px}.row>*{flex:1}.qty{max-width:88px}.cur{max-width:82px}
    .people{display:flex;flex-direction:column;gap:7px}
    .person{display:flex;gap:7px}.person .x{flex:none;width:32px;height:38px;border-radius:9px}
    .add{margin-top:7px;border:1px dashed #ddd7cd;background:transparent;color:#78716c;padding:9px;border-radius:9px;width:100%;cursor:pointer;font-size:13px}
    .sum{margin-top:16px;background:#14100a;color:#fbfaf8;border-radius:13px;padding:13px 15px}
    .sum .l{display:flex;justify-content:space-between;align-items:baseline;font-size:13px;color:#a8a29e}
    .sum .l b{color:#fbfaf8;font-size:19px;font-weight:750}.sum .l+.l{margin-top:6px}
    .cta{margin-top:14px;width:100%;padding:14px;border:0;border-radius:12px;background:#f59e0b;color:#14100a;font-size:15px;font-weight:750;cursor:pointer;display:block;text-align:center;text-decoration:none}
    .cta:disabled{opacity:.55;cursor:progress}
    .err{margin-top:12px;font-size:13px;color:#991b1b;background:#fee2e2;border-radius:9px;padding:10px 12px;line-height:1.5}
    .mem{display:flex;gap:12px;align-items:center;background:#fff;border:1px solid #ece8e1;border-radius:13px;padding:11px;margin-top:9px}
    .mem img{width:84px;height:84px;flex:none;border-radius:9px;background:#f7f5f1}
    .n{font-weight:700;font-size:14px}.a{font-size:19px;font-weight:750;margin:1px 0 7px}
    .lnk{display:inline-block;font-size:12px;font-weight:650;color:#92400e;background:#fef3c7;border:0;border-radius:7px;padding:6px 9px;cursor:pointer;text-decoration:none;margin-right:5px}
    .foot{margin-top:14px;font-size:11.5px;color:#a8a29e;line-height:1.55;border-top:1px solid #ece8e1;padding-top:11px}
    details{margin-top:14px}summary{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#a8a29e;cursor:pointer}
  </style>
  <div class="scrim" part="scrim">
    <div class="sheet">
      <div class="hd"><div class="spark">⚡</div><b>Split this with sutra</b><button class="x" title="Close">✕</button></div>
      <div class="bd"><div class="mut">Reading this page…</div></div>
    </div>
  </div>`

  const scrim = root.querySelector('.scrim')
  const bd = root.querySelector('.bd')
  root.querySelector('.x').addEventListener('click', close)
  scrim.addEventListener('click', (e) => { if (e.target === scrim) close() })
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc, true) }
  }, true)

  const STRATEGY_LABEL = {
    'shopify-cart': 'your live cart', 'json-ld': 'json-ld', 'shopify-meta': 'shopify',
    microdata: 'microdata', og: 'opengraph', 'dom-total': 'page text', selection: 'your selection',
  }

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

  Promise.all([send({ type: 'detect' }), send({ type: 'config' })])
    .then(([det, cfg]) => review(det, cfg))
    .catch((e) => {
      bd.innerHTML = `<div class="err">${esc(e.message)}</div>`
    })

  function review(det, cfg) {
    const conf = det.confidence
    const cls = conf >= 0.75 ? 'hi' : conf >= 0.5 ? 'md' : 'lo'
    const word = conf >= 0.85 ? 'high confidence' : conf >= 0.6 ? 'good confidence' : conf >= 0.35 ? 'low confidence' : 'guess'
    const cur = det.currency || 'USD'
    const unit = det.items[0] ? det.items[0].unit_amount : det.total_minor || 0
    const qty = det.items[0] ? det.items[0].qty : 1
    const members = cfg.members && cfg.members.length ? cfg.members : ['You', 'Friend 1']
    let sub = det.merchant.name
    if (det.event && det.event.start) {
      const d = new Date(det.event.start)
      if (!isNaN(d)) sub += ' · ' + d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    }
    if (det.event && det.event.venue) sub += ' · ' + det.event.venue

    bd.innerHTML = `
      <div class="card">
        ${det.image ? `<img src="${esc(det.image)}" alt="" onerror="this.remove()">` : ''}
        <div class="t">
          <div class="ttl">${esc(det.title)}</div>
          <div class="mut" style="margin-top:2px">${esc(sub)}</div>
          <div class="chips">
            <span class="chip ${cls}">${word} · ${Math.round(conf * 100)}%</span>
            ${det.strategy.map((s) => `<span class="chip">${esc(STRATEGY_LABEL[s] || s)}</span>`).join('')}
          </div>
        </div>
      </div>
      ${det.warnings.length ? `<div class="warn">${det.warnings.slice(0, 4).map((w) => `<div>${esc(w)}</div>`).join('')}</div>` : ''}
      <label>What are you splitting</label>
      <input id="title" maxlength="140" value="${esc(det.title)}">
      <label>Price each · quantity</label>
      <div class="row">
        <input id="cur" class="cur" maxlength="3" value="${esc(cur)}">
        <input id="price" inputmode="decimal" value="${(unit / 10 ** exp(cur)).toFixed(exp(cur))}">
        <input id="qty" class="qty" type="number" min="1" max="99" value="${qty}">
      </div>
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
        <input id="deadline" type="number" min="1" max="10080" value="${cfg.deadlineMinutes}">
      </details>
      <div class="sum">
        <div class="l"><span>Total</span><b id="total">—</b></div>
        <div class="l"><span>Each</span><span id="each"></span></div>
      </div>
      <button class="cta" id="go">Request payment</button>
      <div id="err"></div>
      <div class="foot">Each person approves their own share, capped at that share, locked to this merchant. The cap is enforced by the card network. Detected via <b>${esc(det.provenance.total_minor || 'nothing')}</b>.</div>`

    root.querySelector('#policy').value = cfg.policy || 'all_of'

    const people = root.querySelector('.people')
    const addPerson = (name) => {
      const row = document.createElement('div')
      row.className = 'person'
      const input = document.createElement('input')
      input.value = name
      input.maxLength = 60
      input.placeholder = 'Name'
      input.addEventListener('input', update)
      const rm = document.createElement('button')
      rm.className = 'x'
      rm.textContent = '−'
      rm.addEventListener('click', () => { if (people.children.length > 1) { row.remove(); update() } })
      row.append(input, rm)
      people.appendChild(row)
    }
    members.forEach(addPerson)
    root.querySelector('.add').addEventListener('click', () => {
      if (people.children.length < 20) { addPerson('Friend ' + people.children.length); update() }
    })

    const $ = (s) => root.querySelector(s)
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
      const err = $('#err')
      err.textContent = ''
      if (unitNow <= 0) return (err.innerHTML = '<div class="err">Set a price above zero.</div>')
      if (!who.length) return (err.innerHTML = '<div class="err">Add at least one person.</div>')
      if (!/^[A-Z]{3}$/.test(c)) return (err.innerHTML = '<div class="err">Currency must be a 3-letter code.</div>')

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
        await send({ type: 'save-config', patch: { members: who, policy: policyKind, deadlineMinutes: deadline } })
        const group = await send({
          type: 'create',
          engine: cfg.engine,
          token: cfg.token,
          group: {
            title: ($('#title').value || det.title || 'Group purchase').slice(0, 140),
            merchant: {
              id: 'sutra-extension',
              name: (det.merchant.name || location.hostname).slice(0, 80),
              url: /^https?:\/\//.test(det.merchant.url) ? det.merchant.url : location.origin,
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
        done(group, cfg.engine, c)
      } catch (e) {
        btn.disabled = false
        update()
        err.innerHTML = `<div class="err">${esc(e.message)}</div>`
      }
    })
  }

  function done(group, engine, cur) {
    const base = String(engine).replace(/\/+$/, '')
    bd.innerHTML = `
      <div class="card"><div class="t">
        <div class="ttl">✓ ${group.members.length} mandates requested</div>
        <div class="mut" style="margin-top:3px">Each person scans their own code and approves their own share. Nothing is charged until the policy is satisfied.</div>
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
      <div class="foot">Group ${esc(group.group_id)} · close this page, the board keeps running.</div>`

    root.querySelectorAll('.copy').forEach((b) =>
      b.addEventListener('click', () => {
        navigator.clipboard.writeText(b.dataset.url).then(() => {
          b.textContent = 'copied ✓'
          setTimeout(() => (b.textContent = 'copy link'), 1400)
        })
      }))
  }
})()
