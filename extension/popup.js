const $ = (selector, root = document) => root.querySelector(selector)
const send = (message) => new Promise((resolve, reject) => chrome.runtime.sendMessage(message, (result) => {
  const error = chrome.runtime.lastError
  if (error) return reject(new Error(error.message))
  if (!result?.ok) return reject(new Error(result?.error || 'extension did not respond'))
  resolve(result.data)
}))
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character])
const symbols = { USD: '$', EUR: '€', GBP: '£', INR: '₹', JPY: '¥' }
const exponent = (currency) => currency === 'JPY' ? 0 : 2
const minor = (value, currency) => Math.round(Number(value || 0) * 10 ** exponent(currency))
const money = (value, currency) => (symbols[currency] || currency + ' ') +
  (value / 10 ** exponent(currency)).toFixed(exponent(currency))

let config
let account
let detection
let selected = new Map()
let detectedItems = []
let detectedFees = []
let usesDetectedCartLines = false

function normalizeItems(result) {
  return (Array.isArray(result.items) ? result.items : [])
    .filter((item) => item && Number.isFinite(Number(item.unit_amount)))
    .map((item, index) => ({
      sku: String(item.sku || `extension-item-${index + 1}`),
      name: String(item.name || `Item ${index + 1}`).slice(0, 100),
      unit_amount: Math.max(0, Math.round(Number(item.unit_amount))),
      qty: Math.max(1, Math.round(Number(item.qty) || 1)),
      claimants: ['mi_all'],
    }))
}

function normalizeFees(result) {
  return (Array.isArray(result.fees) ? result.fees : [])
    .filter((fee) => fee && Number.isFinite(Number(fee.amount)) && Number(fee.amount) >= 0)
    .map((fee, index) => ({
      name: String(fee.name || `Fee ${index + 1}`).slice(0, 100),
      amount: Math.round(Number(fee.amount)),
    }))
}

function importedTotal() {
  return detectedItems.reduce((sum, item) => sum + item.unit_amount * item.qty, 0) +
    detectedFees.reduce((sum, fee) => sum + fee.amount, 0)
}

async function boot() {
  try {
    config = await send({ type: 'config' })
  } catch {
    config = { engine: 'https://engine-production-e6fa.up.railway.app', app: 'https://sutra-gmp.vercel.app' }
  }
  if (!config.sessionToken) return renderConnect()
  try {
    account = await send({ type: 'account' })
    $('#account').innerHTML = `<b>${esc(account.user.name)}</b><div class="sub">@${esc(account.user.handle)}</div>`
  } catch (error) {
    return renderConnect(error.message)
  }
  try {
    detection = await send({ type: 'detect' })
    renderReview()
  } catch (error) {
    $('#main').innerHTML = `<div class="card"><b>This page could not be read.</b><div class="error">${esc(error.message)}</div><button class="cta secondary" id="retry">Try again</button></div>`
    $('#retry').onclick = boot
  }
}

function renderConnect(message = '') {
  const appBase = String(config.app || 'https://sutra-gmp.vercel.app').replace(/\/+$/, '')
  $('#account').innerHTML = ''
  $('#main').innerHTML = `<div class="card connect"><div class="mark" style="margin:auto"></div><h2>One account.<br>Every surface.</h2><p class="meta">Connect this extension to the same friends, circles, plans and receipts you use in sutra.</p><button class="cta" id="open">Open account settings</button><input class="token" id="token" type="password" placeholder="Paste extension token"><button class="cta secondary" id="save">Connect extension</button>${message ? `<div class="error">${esc(message)}</div>` : ''}<div class="note">The token is scoped to your account and stored only on this device—not inside the merchant page.</div></div>`
  $('#open').onclick = () => chrome.tabs.create({ url: appBase + '/app/settings' })
  $('#save').onclick = async () => {
    const token = $('#token').value.trim()
    if (!token) return
    await send({ type: 'save-config', patch: { sessionToken: token } })
    location.reload()
  }
}

function renderReview() {
  const currency = (detection.currency || 'USD').toUpperCase()
  detectedItems = normalizeItems(detection)
  detectedFees = normalizeFees(detection)
  usesDetectedCartLines = detectedItems.length > 1
  const first = detectedItems[0]
  const unit = first?.unit_amount ?? detection.total_minor ?? 0
  const qty = first?.qty ?? 1
  const circles = account.circles || []
  const friends = account.friends || []
  selected = new Map([[account.user.id, account.user]])
  const lineList = usesDetectedCartLines
    ? `<div class="section"><div class="label"><span>Detected cart</span><span>${detectedItems.length} lines</span></div><div class="cart-lines">${detectedItems.map((item) => `<div class="cart-line"><b>${esc(item.name)}</b><span>${item.qty} × ${money(item.unit_amount, currency)}</span></div>`).join('')}</div><div class="note">Merchant-reported lines are imported as shown. Verify discounts, shipping and tax at the merchant.</div></div>`
    : `<div class="section"><div class="label"><span>Amount and quantity</span></div><div class="grid"><input id="price" inputmode="decimal" value="${(unit / 10 ** exponent(currency)).toFixed(exponent(currency))}"><input id="qty" type="number" min="1" max="99" value="${qty}"></div></div>`

  $('#main').innerHTML = `<div class="card product">${detection.image ? `<img src="${esc(detection.image)}">` : '<div class="mark"></div>'}<div><div class="kicker">${esc(detection.merchant?.name || 'Detected page')}</div><div class="title">${esc(detection.title || 'Untitled item')}</div><div class="meta">${money(usesDetectedCartLines ? importedTotal() : unit * qty, currency)} · ${esc(detection.strategy?.[0] || 'page')}</div><span class="confidence">${Math.round((detection.confidence || 0) * 100)}% match</span></div></div>
  ${lineList}
  ${circles.length ? `<div class="section"><div class="label"><span>Start with a circle</span><span>${circles.length}</span></div>${circles.map((circle) => `<button class="circle" data-circle="${esc(circle.id)}"><b>${esc(circle.emoji)} ${esc(circle.name)}</b><div class="sub">${circle.members.length} people</div></button>`).join('')}</div>` : ''}
  <div class="section"><div class="label"><span>People</span><span id="count">1 selected</span></div><div class="people"><button class="person on" data-id="${esc(account.user.id)}">You</button>${friends.map((friend) => `<button class="person" data-id="${esc(friend.id)}">${esc(friend.name)}</button>`).join('')}</div>${friends.length ? '' : '<div class="note">Only you and people you are already friends with can sit on a split. Add friends in sutra People first.</div>'}</div>
  <div class="section"><select id="policy"><option value="all_of">Everyone confirms</option><option value="quorum">Majority confirms</option><option value="deadline">Whoever confirms by deadline</option></select></div>
  <div class="sum"><div><span>Proposed total</span><div id="total"></div></div><div style="text-align:right"><span>Proposed per person</span><br><b id="each"></b></div></div><button class="cta" id="create">Create group</button><div id="error"></div><div class="links"><button class="link" id="people">Find friends</button><button class="link" id="settings">Account settings</button><button class="link" id="disconnect">Disconnect</button></div><div class="note">This creates a Sutra group only. The extension does not place an order, control the merchant session or send a payment.</div>`

  const appBase = String(config.app || 'https://sutra-gmp.vercel.app').replace(/\/+$/, '')
  const update = () => {
    const total = usesDetectedCartLines
      ? importedTotal()
      : minor($('#price').value, currency) * Math.max(1, Number($('#qty').value) || 1) + detectedFees.reduce((sum, fee) => sum + fee.amount, 0)
    $('#total').textContent = money(total, currency)
    $('#each').textContent = money(Math.floor(total / Math.max(1, selected.size)), currency)
    $('#count').textContent = `${selected.size} selected`
  }
  document.querySelectorAll('[data-id]').forEach((button) => {
    button.onclick = () => {
      const id = button.dataset.id
      if (id === account.user.id) return
      const person = friends.find((friend) => friend.id === id)
      if (!person) return
      selected.has(id) ? selected.delete(id) : selected.set(id, person)
      button.classList.toggle('on', selected.has(id))
      update()
    }
  })
  document.querySelectorAll('[data-circle]').forEach((button) => {
    button.onclick = () => {
      const circle = circles.find((candidate) => candidate.id === button.dataset.circle)
      selected = new Map(circle.members.map((member) => [member.id, member]))
      document.querySelectorAll('[data-circle]').forEach((candidate) => candidate.classList.toggle('on', candidate === button))
      document.querySelectorAll('[data-id]').forEach((candidate) => candidate.classList.toggle('on', selected.has(candidate.dataset.id)))
      update()
    }
  })
  if (!usesDetectedCartLines) {
    $('#price').oninput = update
    $('#qty').oninput = update
  }
  $('#people').onclick = () => chrome.tabs.create({ url: appBase + '/app/people' })
  $('#settings').onclick = () => chrome.tabs.create({ url: appBase + '/app/settings' })
  $('#disconnect').onclick = async () => {
    await send({ type: 'save-config', patch: { sessionToken: '' } })
    location.reload()
  }
  $('#create').onclick = () => create(currency)
  update()
}

async function create(currency) {
  const button = $('#create')
  const people = [...selected.values()]
  const deadline = config.deadlineMinutes || 60
  const kind = $('#policy').value
  const quorum = Math.max(1, Math.ceil(people.length * 0.6))
  const policy = kind === 'quorum'
    ? { type: 'quorum', m: quorum }
    : kind === 'deadline'
      ? { type: 'deadline', at: new Date(Date.now() + deadline * 60000).toISOString(), primary: { type: 'all_of' }, fallback: { type: 'quorum', m: quorum } }
      : { type: 'all_of' }
  const items = usesDetectedCartLines ? detectedItems : [{
    sku: detectedItems[0]?.sku || 'extension-item-1',
    name: (detectedItems[0]?.name || detection.title || 'Item').slice(0, 100),
    unit_amount: minor($('#price').value, currency),
    qty: Math.max(1, Math.round(Number($('#qty').value) || 1)),
    claimants: ['mi_all'],
  }]
  const proposedTotal = items.reduce((sum, item) => sum + item.unit_amount * item.qty, 0) +
    detectedFees.reduce((sum, fee) => sum + fee.amount, 0)
  if (proposedTotal <= 0) {
    $('#error').innerHTML = '<div class="error">Set a price above zero.</div>'
    return
  }
  button.disabled = true
  button.textContent = 'Creating your group…'
  try {
    const result = await send({
      type: 'create',
      group: {
        title: (detection.title || 'Group purchase').slice(0, 140),
        merchant: {
          id: 'extension',
          name: (detection.merchant?.name || 'Merchant').slice(0, 80),
          url: detection.page_url || detection.merchant?.url || 'https://example.com',
          country_code_iso2: (detection.merchant?.country_code_iso2 || (typeof navigator !== 'undefined' && navigator.language || 'en-IN').split('-')[1] || 'IN').slice(0, 2).toUpperCase(),
        },
        cart: { items, fees: detectedFees, currency },
        members: people.map((person) => ({ name: person.name.slice(0, 60), role: 'payer', user_id: person.id })),
        policy,
        deadline_minutes: deadline,
        rail: 'checkout_handoff',
      },
    })
    const appBase = String(config.app || 'https://sutra-gmp.vercel.app').replace(/\/+$/, '')
    const board = new URL(result.board_url, appBase + '/').href
    $('#main').innerHTML = `<div class="card connect"><div style="font-size:38px">✓</div><h2>Group and invitations created.</h2><p class="meta">${result.members.length} people can now review the proposed shares. No order or payment was sent to the merchant.</p><button class="cta" id="board">Open group board</button><div class="note">Keep the merchant tab open and finish there. Sutra does not retain the merchant session, submit checkout details or verify payment.</div></div>`
    $('#board').onclick = () => chrome.tabs.create({ url: board })
  } catch (error) {
    button.disabled = false
    button.textContent = 'Create group'
    const message = error.message || String(error)
    const friendly = /aren.?t friends|friend request|needs a sutra account/i.test(message)
      ? `${message} Open People in sutra, become friends, then try again.`
      : message
    $('#error').innerHTML = `<div class="error">${esc(friendly)}</div>`
  }
}

boot()
