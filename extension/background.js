/* sutra — MV3 service worker.
 *
 * Holds the three privileged operations so nothing else needs permissions:
 *
 *   detect(tabId)  injects detect.js into the page's MAIN world and calls it.
 *                  MAIN world matters: an isolated content script cannot see
 *                  window.Shopify / window.ShopifyAnalytics, which is how a
 *                  large slice of the web describes its cart.
 *
 *   create(...)    POSTs to the engine from the extension origin, so the
 *                  API token never enters the page and the page cannot
 *                  intercept the response.
 *
 *   mount(tabId)   injects content.js to draw the sheet on the page itself.
 *
 * There are no host permissions. Everything is gated on activeTab, which
 * Chrome grants for one tab, on a user gesture, and revokes on navigation.
 */

const DEFAULTS = {
  engine: 'http://localhost:4100',
  token: 'dev-token',
  members: ['You', 'Friend 1'],
  policy: 'all_of',
  deadlineMinutes: 60,
}

async function getConfig() {
  const stored = await chrome.storage.sync.get(DEFAULTS)
  return { ...DEFAULTS, ...stored }
}

/** Run the detector inside the page, in the world that can see its globals. */
async function detect(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['detect.js'],
    world: 'MAIN',
  })
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      let selectionText = ''
      try {
        selectionText = String(window.getSelection() || '')
      } catch (e) {}
      // detectCart resolves even when every strategy fails.
      return globalThis.SutraDetect.detectCart(document, location, { selectionText })
    },
  })
  if (!res || !res.result) throw new Error('the detector returned nothing')
  return res.result
}

/** POST /v1/groups — request shape from engine/src/routes.ts. */
async function createGroup({ engine, token, group }) {
  const base = String(engine || '').replace(/\/+$/, '')
  let res
  try {
    res = await fetch(base + '/v1/groups', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token || ''}` },
      body: JSON.stringify(group),
    })
  } catch (e) {
    throw new Error(`could not reach the engine at ${base} — is it running?`)
  }
  const raw = await res.text()
  if (!res.ok) {
    let msg = raw
    try {
      const j = JSON.parse(raw)
      msg = j.error || raw
      if (j.details) msg += ' — ' + j.details.map((d) => `${(d.path || []).join('.')}: ${d.message}`).join('; ')
    } catch (e) {}
    if (res.status === 401) msg = 'the engine rejected the API token (Settings → API token)'
    throw new Error(`engine ${res.status}: ${String(msg).slice(0, 300)}`)
  }
  return JSON.parse(raw)
}

async function mount(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['detect.js'], world: 'MAIN' })
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] })
  return { ok: true }
}

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (!tab) throw new Error('no active tab')
  if (/^(chrome|edge|about|devtools|chrome-extension):/i.test(tab.url || '')) {
    throw new Error('Chrome does not allow extensions to run on this page. Open a real site and try again.')
  }
  return tab.id
}

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  ;(async () => {
    try {
      switch (msg && msg.type) {
        case 'detect':
          return respond({ ok: true, data: await detect(msg.tabId ?? (await activeTabId())) })
        case 'create':
          return respond({ ok: true, data: await createGroup(msg) })
        case 'config':
          return respond({ ok: true, data: await getConfig() })
        case 'save-config':
          await chrome.storage.sync.set(msg.patch || {})
          return respond({ ok: true, data: await getConfig() })
        case 'mount':
          return respond({ ok: true, data: await mount(msg.tabId ?? (await activeTabId())) })
        default:
          return respond({ ok: false, error: 'unknown message ' + JSON.stringify(msg && msg.type) })
      }
    } catch (e) {
      respond({ ok: false, error: e && e.message ? e.message : String(e) })
    }
  })()
  return true // keep the channel open for the async respond
})

// Keyboard shortcut → straight to the on-page sheet, no popup.
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'split-this-page') return
  try {
    await mount(await activeTabId())
  } catch (e) {
    console.warn('[sutra]', e.message)
  }
})

// Only fires if default_popup is removed from the manifest. Kept so that
// stripping the popup gives you the one-click on-page flow for free.
chrome.action.onClicked.addListener(async (tab) => {
  try {
    await mount(tab.id)
  } catch (e) {
    console.warn('[sutra]', e.message)
  }
})
