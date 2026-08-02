// sutra — film · Scene 8 · WHAT IT DOES NOT DO (2:25-2:45)
// --------------------------------------------------------------------------
// Plain, still, dark card. No animation beyond a single fade. This is the
// scene that earns trust in the other eight, so it gets none of their
// motion — just the honest boundary, held.
//
// Copy is verbatim SCRIPT.md, cross-checked against the same claim already
// shipping in the real product: web/src/components/group/TerminalBanner.tsx
// ("Sutra does not place the order for you. One cart paid by N different
// cards only works where {merchant} accepts more than one card for a
// single order...") says the same thing, in the same register, live today.

(function () {
  var START = 145000;
  var END = 165000;

  function el(tag, className, parent) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (parent) parent.appendChild(e);
    return e;
  }

  function injectStyle() {
    var css = ''
      + '#film-scene-s8-limits{background:var(--paper)}'
      + '.s8-card{position:absolute;left:50%;top:112px;transform:translateX(-50%);width:1620px;height:760px;'
      + 'background:var(--ink);border-radius:var(--r-lg);box-shadow:var(--shadow-3);'
      + 'display:flex;align-items:center;justify-content:center}'
      + '.s8-wrap{width:1180px;text-align:center}'
      + '.s8-eyebrow{font-family:var(--font-mono);font-size:13px;letter-spacing:.14em;text-transform:uppercase;'
      + 'color:#9a958a}'
      + '.s8-h1{margin-top:22px;font-size:52px;font-weight:640;letter-spacing:-.02em;color:#f3f0ea}'
      + '.s8-rule{margin:34px auto;width:64px;height:2px;background:#54504a}'
      + '.s8-p{margin-top:22px;font-size:22px;line-height:1.62;color:#c9c4ba;max-width:1040px;'
      + 'margin-left:auto;margin-right:auto}'
      + '.s8-p b{color:#f3f0ea;font-weight:620}';
    var style = el('style', '', document.head);
    style.textContent = css;
  }

  function mount(root) {
    injectStyle();

    var card = el('div', 's8-card', root);
    card.style.opacity = '0';
    var wrap = el('div', 's8-wrap', card);

    el('div', 's8-eyebrow', wrap).textContent = 'WHAT IT DOES NOT DO';
    el('div', 's8-h1', wrap).textContent = 'Where this stops.';
    el('div', 's8-rule', wrap);

    var p1 = el('div', 's8-p', wrap);
    p1.innerHTML =
      'A shared online cart is paid by several cards. Most checkouts have one card field — ' +
      'so sutra <b>collects the money, but does not place that order.</b>';

    var p2 = el('div', 's8-p', wrap);
    p2.innerHTML =
      'It completes end to end when <b>everyone buys their own item</b>, and <b>at a venue</b>, ' +
      'where a table has always been able to hand over four cards.';

    var p3 = el('div', 's8-p', wrap);
    p3.innerHTML =
      'Every charge carries the same group reference. That is the hook a merchant would reconcile on. ' +
      'It is a proposal. <b>Nobody has adopted it yet.</b>';

    root._els = { card: card };
  }

  function draw(t, root) {
    var FILM = window.FILM;
    var fade = FILM.easeOut(FILM.progress(t, 0, 900));
    root._els.card.style.opacity = String(fade);
  }

  window.FILM.register({
    id: 's8-limits',
    startMs: START,
    endMs: END,
    mount: mount,
    draw: draw,
  });

  window.FILM.caption('We would rather tell you than have you find out.', START + 14500, END);
})();
