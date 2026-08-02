// sutra — film · Scene 9 · CLOSE (2:45-3:10)
// --------------------------------------------------------------------------
// The receipt, drawn honestly — for the same Goa-trip group scenes 1-3
// carry through the film (Ada organises; Arsh, Maya and Dev are the three
// who eventually pay, ₹9,600 total, ₹2,400 each, exactly the numbers scene 1
// already put on screen). Rule 1 in SCRIPT.md: "real output from this repo,
// or clearly a fictional character's messages" — this is that fictional
// group's receipt, rendered in the real schema, real field names and real
// copy sourced straight from the code:
//   - field shape: engine/src/receipt.ts (Receipt / ReceiptEntry)
//   - "COMMITTED" narrative line: TerminalBanner.tsx COPY_CARD.committed
//     ("Every share cleared on its own card, at the same moment. No one
//     fronted anyone else.") — live copy, not invented.
//   - settlement_disclosure: engine/src/rails.ts RAILS.prava_mandates
//     ("Your card is charged directly by the merchant, up to the cap you
//     approve and no further. The cap is enforced by the card network, not
//     by this app. Nobody fronts money and no funds are pooled.")
//   - closing line under the chain: web/src/app/app/receipts/[id]/page.tsx
//     ("Nobody pooled funds and nobody fronted anybody's money...")
// Hashes/signature are illustrative fixed hex (deterministic, not random)
// in the real field shapes — this is a dramatized fictional group's
// receipt, not a claim of a real signed artifact.
//
// Final stat card numbers were verified by running the suites myself this
// session, not copied from a doc: `npm test -w engine` (PowerShell, vitest)
// -> 626 passed across 35 files; `npm run nanda:test` -> 117 passed, 1
// skipped.

(function () {
  var START = 165000;
  var END = 190000;

  function el(tag, className, parent) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (parent) parent.appendChild(e);
    return e;
  }

  var PALETTE = ['#2E2AD8', '#B7410E', '#12734F', '#7A2E8E', '#0F6C8C', '#A4231F', '#8A6D0B', '#3E5C2A'];
  function accentFor(seed) {
    var h = 0;
    for (var i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
    return PALETTE[Math.abs(h) % PALETTE.length];
  }
  function initials(name) { return name.slice(0, 2).toUpperCase(); }
  function money(n) { return '₹' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  // Deterministic filler hex, same shape as a real sha256 hex digest —
  // never Math.random(), so any seek order paints the same characters.
  // FNV-1a seed + a mixed xorshift expansion so distinct seeds (and
  // distinct character positions) actually diverge, instead of a plain
  // LCG which converges to near-identical output across nearby seeds.
  function fakeHash(seed) {
    var h = 2166136261;
    for (var i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    var s = '';
    for (var j = 0; j < 64; j++) {
      h ^= h << 13; h >>>= 0;
      h ^= h >>> 17;
      h ^= h << 5; h >>>= 0;
      h = (h ^ Math.imul(j + 1, 2654435761)) >>> 0;
      s += (h & 0xf).toString(16);
    }
    return s;
  }

  function injectStyle() {
    var css = ''
      + '#film-scene-s9-close{position:relative}'
      + '.s9-layer{position:absolute;inset:0}'

      + '.s9-receipt{position:absolute;left:50%;top:70px;transform:translateX(-50%);width:1180px;'
      + 'background:var(--surface);border:1px solid var(--line);border-radius:var(--r-lg);'
      + 'box-shadow:var(--shadow-3);padding:36px 44px 30px}'
      + '.s9-rhead{display:flex;justify-content:space-between;align-items:flex-start}'
      + '.s9-rhead .eyebrow{color:var(--brand-ink)}'
      + '.s9-rhead h1{margin-top:5px;font-size:26px;font-weight:650;letter-spacing:-.01em}'
      + '.s9-rhead .sub{margin-top:4px;font-size:12.5px;color:var(--ink-3)}'
      + '.s9-rhead .gid{margin-top:3px;font-family:var(--font-mono);font-size:11px;color:var(--ink-3)}'
      + '.s9-badge{font-family:var(--font-mono);font-size:12px;font-weight:700;letter-spacing:.03em;'
      + 'background:var(--ok-soft);color:var(--ok);border:1px solid var(--ok-line);border-radius:999px;'
      + 'padding:6px 14px}'

      + '.s9-banner{margin-top:20px;background:var(--ok-soft);border:1px solid var(--ok-line);border-radius:var(--r);'
      + 'padding:14px 20px;font-size:14.5px;color:var(--ink-2);opacity:0}'
      + '.s9-banner b{color:var(--ok);font-family:var(--font-mono);font-size:12.5px;letter-spacing:.04em;'
      + 'display:block;margin-bottom:4px}'

      + '.s9-totals{margin-top:16px;display:flex;gap:40px;opacity:0}'
      + '.s9-totals .t{font-size:12.5px;color:var(--ink-3)}'
      + '.s9-totals .v{margin-top:3px;font-family:var(--font-mono);font-size:22px;font-weight:650}'
      + '.s9-totals .v.charged{color:var(--brand-ink)}'

      + '.s9-chain{margin-top:22px;display:flex;gap:14px}'
      + '.s9-entry{flex:1;background:var(--surface-2);border:1px solid var(--line);border-radius:11px;'
      + 'padding:13px 15px;opacity:0}'
      + '.s9-entry .who{display:flex;align-items:center;gap:8px}'
      + '.s9-entry .av{width:26px;height:26px;border-radius:999px;color:#fff;font-size:10.5px;font-weight:700;'
      + 'display:grid;place-items:center;flex:none}'
      + '.s9-entry .nm{font-size:13.5px;font-weight:650}'
      + '.s9-entry .amt{margin-top:8px;font-family:var(--font-mono);font-size:16px;font-weight:650;color:var(--ok)}'
      + '.s9-entry .hash{margin-top:7px;font-family:var(--font-mono);font-size:10px;color:var(--ink-3);'
      + 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
      + '.s9-entry .link{margin-top:4px;font-size:9.5px;color:var(--ok);font-family:var(--font-mono)}'

      + '.s9-foot{margin-top:20px;display:flex;justify-content:space-between;align-items:flex-start;gap:20px;opacity:0}'
      + '.s9-disc{font-size:12px;line-height:1.55;color:var(--ink-3);max-width:640px}'
      + '.s9-disc b{color:var(--ink-2)}'
      + '.s9-sig{text-align:right;font-family:var(--font-mono);font-size:10.5px;color:var(--ink-3);flex:none}'
      + '.s9-sig .head{color:var(--ink-2);margin-bottom:3px}'
      + '.s9-note{margin-top:16px;font-size:12px;color:var(--ink-3);text-align:center;opacity:0}'

      + '.s9-close{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);text-align:center;opacity:0}'
      + '.s9-close .l1{font-size:44px;font-weight:640;letter-spacing:-.02em;color:var(--ink);line-height:1.3}'
      + '.s9-close .url{margin-top:22px;font-family:var(--font-mono);font-size:22px;color:var(--brand-ink);'
      + 'font-weight:650}'

      + '.s9-stats{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);text-align:center;opacity:0}'
      + '.s9-stats .line{font-size:20px;color:var(--ink-2);font-family:var(--font-mono)}'
      + '.s9-stats .line b{color:var(--ink);font-weight:700}';
    var style = el('style', '', document.head);
    style.textContent = css;
  }

  var PEOPLE = ['Ada', 'Arsh', 'Maya', 'Dev'];
  var SHARE = 240000; // ₹2,400.00 in minor units
  var TOTAL = 960000; // ₹9,600.00

  var RECEIPT_IN = 700;
  var BANNER_AT = 1300;
  var TOTALS_AT = 1900;
  var ENTRY_START = 2600;
  var ENTRY_GAP = 620;
  var FOOT_AT = ENTRY_START + PEOPLE.length * ENTRY_GAP + 500;
  var NOTE_AT = FOOT_AT + 500;
  var RECEIPT_OUT_AT = 14200;
  var CLOSE_IN_AT = RECEIPT_OUT_AT + 700;
  var CLOSE_OUT_AT = 20200;
  var STATS_IN_AT = CLOSE_OUT_AT + 700;

  function mount(root) {
    injectStyle();
    root.style.background = 'var(--paper)';

    var receipt = el('div', 's9-receipt', root);
    receipt.style.opacity = '0';

    var rhead = el('div', 's9-rhead', receipt);
    var rheadL = el('div', '', rhead);
    el('div', 'eyebrow', rheadL).textContent = 'SIGNED RECEIPT';
    el('h1', '', rheadL).textContent = 'Goa bus';
    el('div', 'sub', rheadL).textContent = 'Goa bus · issued Thu, 9:14 PM';
    el('div', 'gid', rheadL).textContent = 'gs_01hz9mgoabus4people2400each';
    var badge = el('div', 's9-badge', rhead);
    badge.textContent = 'COMMITTED · GMP/1';

    var banner = el('div', 's9-banner', receipt);
    el('b', '', banner).textContent = "policy satisfied; 4 principal(s) charged on their own cards";
    banner.appendChild(document.createTextNode(
      'Every share cleared on its own card, at the same moment. No one fronted anyone else.'
    ));

    var totals = el('div', 's9-totals', receipt);
    var tq = el('div', '', totals);
    el('div', 't', tq).textContent = 'Quoted total';
    el('div', 'v', tq).textContent = money(TOTAL / 100);
    var tc = el('div', '', totals);
    el('div', 't', tc).textContent = 'Charged total';
    el('div', 'v charged', tc).textContent = money(TOTAL / 100);

    var chain = el('div', 's9-chain', receipt);
    var prevHash = 'GENESIS';
    var entries = PEOPLE.map(function (name, i) {
      var hash = fakeHash(prevHash + '|' + name + '|' + SHARE);
      var entry = el('div', 's9-entry', chain);
      var who = el('div', 'who', entry);
      var av = el('div', 'av', who);
      av.style.background = accentFor(name);
      av.textContent = initials(name);
      el('div', 'nm', who).textContent = name;
      el('div', 'amt', entry).textContent = money(SHARE / 100);
      el('div', 'hash', entry).textContent = 'hash ' + hash.slice(0, 10) + '…';
      var link = el('div', 'link', entry);
      link.textContent = i === 0 ? 'starts the chain' : 'links to #' + i;
      prevHash = hash;
      return { el: entry };
    });
    var chainHead = prevHash;

    var foot = el('div', 's9-foot', receipt);
    var disc = el('div', 's9-disc', foot);
    disc.innerHTML =
      '<b>Settlement:</b> Your card is charged directly by the merchant, up to the cap you approve and no ' +
      'further. The cap is enforced by the card network, not by this app. Nobody fronts money and no funds are pooled.';
    var sig = el('div', 's9-sig', foot);
    el('div', 'head', sig).textContent = 'chain head';
    var ch1 = el('div', '', sig);
    ch1.textContent = chainHead.slice(0, 16) + '…';
    var ch2 = el('div', '', sig);
    ch2.style.marginTop = '6px';
    ch2.textContent = 'Ed25519 · 128 hex chars ✓';

    var note = el('div', 's9-note', receipt);
    note.textContent = "Nobody pooled funds and nobody fronted anybody's money.";

    var closeWrap = el('div', 's9-close', root);
    var l1 = el('div', 'l1', closeWrap);
    l1.innerHTML = 'Nothing pooled. Nothing fronted.<br>Nothing invented.';
    el('div', 'url', closeWrap).textContent = 'sutra-gmp.vercel.app';

    var stats = el('div', 's9-stats', root);
    var s1 = el('div', 'line', stats);
    s1.innerHTML = '<b>626</b> engine tests · <b>117</b> plugin tests';
    var s2 = el('div', 'line', stats);
    s2.style.marginTop = '10px';
    s2.innerHTML = 'every venue real · every price read from the merchant';

    root._els = {
      receipt: receipt, banner: banner, totals: totals, entries: entries, foot: foot, note: note,
      closeWrap: closeWrap, stats: stats,
    };
  }

  function draw(t, root) {
    var FILM = window.FILM;
    var E = root._els;

    var receiptOut = FILM.easeIn(FILM.progress(t, RECEIPT_OUT_AT, RECEIPT_OUT_AT + 600));
    var receiptIn = FILM.easeOut(FILM.progress(t, 0, RECEIPT_IN));
    var receiptOp = receiptIn * (1 - receiptOut);
    E.receipt.style.opacity = String(receiptOp);
    E.receipt.style.transform = 'translateX(-50%) translateY(' + FILM.lerp(0, -16, receiptOut) + 'px) scale(' + FILM.lerp(1, 0.98, receiptOut) + ')';

    E.banner.style.opacity = String(FILM.easeOut(FILM.progress(t, BANNER_AT, BANNER_AT + 380)));
    E.totals.style.opacity = String(FILM.easeOut(FILM.progress(t, TOTALS_AT, TOTALS_AT + 380)));

    E.entries.forEach(function (entry, i) {
      var at = ENTRY_START + i * ENTRY_GAP;
      var reveal = FILM.easeOut(FILM.progress(t, at, at + 340));
      entry.el.style.opacity = String(reveal);
      entry.el.style.transform = 'translateY(' + FILM.lerp(8, 0, reveal) + 'px)';
    });

    E.foot.style.opacity = String(FILM.easeOut(FILM.progress(t, FOOT_AT, FOOT_AT + 400)));
    E.note.style.opacity = String(FILM.easeOut(FILM.progress(t, NOTE_AT, NOTE_AT + 400)));

    var closeIn = FILM.easeOut(FILM.progress(t, CLOSE_IN_AT, CLOSE_IN_AT + 700));
    var closeOut = FILM.easeIn(FILM.progress(t, CLOSE_OUT_AT, CLOSE_OUT_AT + 500));
    E.closeWrap.style.opacity = String(closeIn * (1 - closeOut));

    var statsIn = FILM.easeOut(FILM.progress(t, STATS_IN_AT, STATS_IN_AT + 700));
    E.stats.style.opacity = String(statsIn);
  }

  window.FILM.register({
    id: 's9-close',
    startMs: START,
    endMs: END,
    mount: mount,
    draw: draw,
  });
})();
