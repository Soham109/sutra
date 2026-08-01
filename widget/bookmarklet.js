/* sutra bookmarklet — the zero-install path.
 *
 * Source form. `node widget/build-bookmarklet.mjs` minifies this, substitutes
 * the engine origin for __SUTRA_BASE__, percent-encodes it and writes the
 * `javascript:` URL to widget/bookmarklet.url.txt + the demo page.
 *
 * All it does is inject widget.js and open the sheet. Everything else — the
 * detection, the UI, the POST — lives in widget.js, so a bookmark saved once
 * keeps working as the widget changes.
 *
 * Constraints that shape this file:
 *   - it is pasted into pages with strict CSP, so it must fail visibly rather
 *     than silently when the script tag is blocked;
 *   - it must be idempotent: clicking the bookmark twice reopens the sheet
 *     instead of stacking two of them;
 *   - it must never leave anything behind on the page if it fails.
 */
;(function () {
  var BASE = '__SUTRA_BASE__'

  function toast(msg) {
    try {
      var t = document.createElement('div')
      t.textContent = msg
      t.style.cssText =
        'all:initial;position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483647;' +
        'font:600 13px/1.5 ui-sans-serif,system-ui,sans-serif;background:#14100a;color:#fbfaf8;' +
        'padding:11px 16px;border-radius:11px;box-shadow:0 10px 30px rgba(0,0,0,.35);max-width:82vw'
      document.documentElement.appendChild(t)
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t) }, 6000)
    } catch (e) {
      alert(msg)
    }
  }

  // Already loaded? Just reopen — a bookmark click should be idempotent.
  if (window.__sutra && window.__sutra.open) {
    window.__sutra.open()
    return
  }

  var existing = document.querySelector('script[data-sutra-widget]')
  if (existing) {
    toast('sutra is still loading…')
    return
  }

  var s = document.createElement('script')
  s.src = BASE + '/widget.js?t=' + Date.now()
  s.setAttribute('data-sutra-widget', '')
  s.setAttribute('data-sutra-open', '') // open the sheet as soon as it lands
  s.setAttribute('data-gmp-mount', 'none') // no launcher button; the sheet is the point
  s.async = true
  s.onerror = function () {
    if (s.parentNode) s.parentNode.removeChild(s)
    toast('sutra could not load from ' + BASE + ' — this page blocks outside scripts, or the engine is down.')
  }
  document.documentElement.appendChild(s)

  // Content-Security-Policy failures do not always fire onerror. If nothing
  // has claimed the global after a beat, say so instead of looking broken.
  setTimeout(function () {
    if (!window.__sutra) {
      toast("sutra didn't load — this page's Content-Security-Policy blocks injected scripts. Use the extension here.")
    }
  }, 4000)
})()
