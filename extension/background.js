/* sutra MV3 service worker. Page access requires an activeTab gesture.
 * The account token stays in extension-local storage and never enters a page. */
const DEFAULTS = {
  engine: 'https://engine-production-e6fa.up.railway.app',
  app: 'https://sutra-gmp.vercel.app',
  policy: 'all_of',
  deadlineMinutes: 60,
}

async function getConfig() {
  const [preferences, secrets] = await Promise.all([
    chrome.storage.sync.get(DEFAULTS),
    chrome.storage.local.get({ sessionToken: '' }),
  ])
  return { ...DEFAULTS, ...preferences, ...secrets }
}

async function api(path, options = {}) {
  const cfg = await getConfig()
  if (!cfg.sessionToken) throw new Error('connect your sutra account first')
  let response
  try {
    response = await fetch(String(cfg.engine).replace(/\/+$/, '') + path, {
      ...options,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.sessionToken}`, ...(options.headers || {}) },
    })
  } catch { throw new Error('the sutra engine could not be reached') }
  const raw = await response.text()
  let body = {}
  try { body = raw ? JSON.parse(raw) : {} } catch { body = { error: raw } }
  if (!response.ok) throw new Error(body.error || `engine ${response.status}`)
  return body
}

async function detect(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['detect.js'], world: 'MAIN' })
  const [result] = await chrome.scripting.executeScript({
    target: { tabId }, world: 'MAIN',
    func: () => {
      let selectionText = ''
      try { selectionText = String(window.getSelection() || '') } catch {}
      return globalThis.SutraDetect.detectCart(document, location, { selectionText })
    },
  })
  if (!result?.result) throw new Error('this page did not return a detectable product')
  return result.result
}

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (!tab) throw new Error('no active tab')
  if (/^(chrome|edge|about|devtools|chrome-extension):/i.test(tab.url || '')) {
    throw new Error('Open a product, ticket, stay, or cart page and try again.')
  }
  return tab.id
}

async function mount(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['detect.js'], world: 'MAIN' })
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] })
  return { ok: true }
}

chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  ;(async () => {
    try {
      switch (msg?.type) {
        case 'detect': return respond({ ok: true, data: await detect(msg.tabId ?? await activeTabId()) })
        case 'create': return respond({ ok: true, data: await api('/v1/extension/groups', { method: 'POST', body: JSON.stringify(msg.group) }) })
        case 'account': return respond({ ok: true, data: await api('/v1/me') })
        case 'config': return respond({ ok: true, data: await getConfig() })
        case 'save-config': {
          const patch = { ...(msg.patch || {}) }
          if (Object.prototype.hasOwnProperty.call(patch, 'sessionToken')) {
            await chrome.storage.local.set({ sessionToken: patch.sessionToken || '' })
            delete patch.sessionToken
          }
          await chrome.storage.sync.set(patch)
          return respond({ ok: true, data: await getConfig() })
        }
        case 'mount': return respond({ ok: true, data: await mount(msg.tabId ?? await activeTabId()) })
        default: return respond({ ok: false, error: 'unknown extension message' })
      }
    } catch (error) { respond({ ok: false, error: error?.message || String(error) }) }
  })()
  return true
})

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'split-this-page') return
  try { await mount(await activeTabId()) } catch (error) { console.warn('[sutra]', error.message) }
})
