// sutra — film · Scene 4 · WHERE A SPLIT COMES FROM (1:05-1:22)
// --------------------------------------------------------------------------
// Four fast cuts, real UI shapes, real data pulled from this repo — nothing
// on screen is invented:
//
//   1. Say it            -> composer.tsx's own placeholder sentence, resolved
//                           against a live local run of e2e/plan-flow.ts
//                           (real OpenStreetMap venues near Koramangala).
//   2. Paste a link       -> engine/test/resolver-live-fixes.test.ts's own
//                           fixture: a real, live Fashion Nova product page.
//   3. The extension      -> extension/content.js's real sheet copy.
//   4. Photograph a bill  -> engine/test/bill-integrity.test.ts's CLEAN
//                           fixture (TOIT BREWPUB, ₹2,587.50) and the exact
//                           reconciliation sentence engine/src/bill/parse.ts
//                           actually prints.
//
// Same discipline as every other scene: mount() builds every cut's DOM once,
// at opacity 0; draw(localT) is the only thing that ever sets a style, always
// computed fresh from localT so any seek order paints identically.

(function () {
  var START = 65000;
  var END = 82000;
  var DUR = END - START;
  var CUT = DUR / 4; // 4250ms per cut
  var FADE = 150;

  function el(tag, className, parent) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (parent) parent.appendChild(e);
    return e;
  }

  function money(minor, currency) {
    var symbols = { INR: '₹', USD: '$' };
    var sym = symbols[currency] || currency + ' ';
    var value = (minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return sym + value;
  }

  // Local-to-cut visibility: 0 outside [start,end), fast fade at both edges —
  // "fast cuts", not crossfades.
  function cutOpacity(t, start, end) {
    var FILM = window.FILM;
    if (t < start || t >= end) return 0;
    var inV = FILM.easeOut(FILM.progress(t, start, start + FADE));
    var outV = 1 - FILM.easeIn(FILM.progress(t, end - FADE, end));
    return Math.min(inV, outV);
  }

  function injectStyle() {
    var css = ''
      + '#film-scene-s4-surfaces{position:relative}'
      + '.s4-cut{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center}'
      + '.s4-eyebrow-row{margin-top:112px;text-align:center}'
      + '.s4-eyebrow-row .eyebrow{color:var(--brand-ink)}'
      + '.s4-bar{margin-top:26px;width:1180px;background:var(--surface);border:1px solid var(--line);'
      + 'border-radius:var(--r-lg);box-shadow:var(--shadow-2);padding:26px 34px;display:flex;align-items:center;gap:16px}'
      + '.s4-bar .glyph{font-size:22px;color:var(--ink-3);flex:none}'
      + '.s4-bar .txt{font-size:26px;letter-spacing:-0.01em;color:var(--ink);flex:1;white-space:nowrap;overflow:hidden}'
      + '.s4-caret{display:inline-block;width:2px;height:28px;background:var(--brand);margin-left:2px;vertical-align:-6px}'
      + '.s4-results{margin-top:30px;width:1180px;display:flex;flex-direction:column;gap:14px}'
      + '.s4-venue{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);'
      + 'box-shadow:var(--shadow-1);padding:20px 26px;display:flex;align-items:center;gap:22px}'
      + '.s4-venue .rank{width:40px;height:40px;border-radius:999px;background:var(--surface-2);color:var(--ink-2);'
      + 'display:grid;place-items:center;font-family:var(--font-mono);font-size:15px;font-weight:650;flex:none}'
      + '.s4-venue .body{flex:1;min-width:0}'
      + '.s4-venue .name{font-size:21px;font-weight:640;letter-spacing:-0.01em}'
      + '.s4-venue .addr{margin-top:3px;font-size:14px;color:var(--ink-3)}'
      + '.s4-venue .pct{font-family:var(--font-mono);font-size:20px;font-weight:650;color:var(--brand-ink);flex:none}'
      + '.s4-map{position:absolute;right:190px;top:158px;width:150px;height:150px;border-radius:var(--r-lg);'
      + 'background:var(--surface-2);border:1px solid var(--line);overflow:hidden;box-shadow:var(--shadow-2)}'
      + '.s4-map .grid{position:absolute;inset:0;'
      + 'background-image:linear-gradient(var(--line) 1px,transparent 1px),linear-gradient(90deg,var(--line) 1px,transparent 1px);'
      + 'background-size:29px 29px;opacity:.55}'
      + '.s4-map .pin{position:absolute;left:50%;top:50%;width:16px;height:16px;border-radius:999px 999px 999px 2px;'
      + 'background:var(--brand);transform:translate(-50%,-100%) rotate(-45deg);box-shadow:0 3px 8px rgba(0,0,0,.25)}'
      + '.s4-map .pin::after{content:"";position:absolute;left:50%;top:50%;width:6px;height:6px;border-radius:999px;'
      + 'background:#fff;transform:translate(-50%,-50%) rotate(45deg)}'
      + '.s4-map .ring{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);border-radius:999px;'
      + 'border:2px solid var(--brand-line)}'

      + '.s4-url{margin-top:118px;width:1020px;background:var(--surface);border:1px solid var(--line);'
      + 'border-radius:999px;box-shadow:var(--shadow-1);padding:15px 26px;display:flex;align-items:center;gap:12px}'
      + '.s4-url .glyph{color:var(--ink-3);font-size:16px;flex:none}'
      + '.s4-url .txt{font-family:var(--font-mono);font-size:15.5px;color:var(--ink-2);white-space:nowrap;overflow:hidden}'
      + '.s4-product{margin-top:40px;width:640px;background:var(--surface);border:1px solid var(--line);'
      + 'border-radius:var(--r-lg);box-shadow:var(--shadow-2);overflow:hidden;display:flex}'
      + '.s4-product .img{width:230px;flex:none;background:linear-gradient(135deg,var(--surface-3),var(--surface-2));'
      + 'display:grid;place-items:center;color:var(--ink-3);font-size:13px}'
      + '.s4-product .info{padding:26px 30px;display:flex;flex-direction:column;gap:10px;flex:1;min-width:0}'
      + '.s4-product .row1{display:flex;align-items:center;justify-content:space-between;gap:10px}'
      + '.s4-product .domain{font-family:var(--font-mono);font-size:13px;color:var(--ink-3)}'
      + '.s4-product .badge{font-family:var(--font-mono);font-size:11px;letter-spacing:.05em;text-transform:uppercase;'
      + 'background:var(--surface-2);color:var(--ink-2);border-radius:999px;padding:4px 10px}'
      + '.s4-product .title{font-size:22px;font-weight:620;letter-spacing:-0.01em;line-height:1.32}'
      + '.s4-product .price{font-family:var(--font-mono);font-size:34px;font-weight:650;color:var(--ink);margin-top:4px}'
      + '.s4-product .cta{margin-top:auto;align-self:flex-start;background:var(--brand);color:#fff;font-weight:640;'
      + 'font-size:14px;border-radius:var(--r-sm);padding:11px 20px}'

      + '.s4-checkout{position:absolute;left:50%;top:400px;transform:translateX(-50%);width:640px;'
      + 'background:var(--surface);border:1px solid var(--line);border-radius:var(--r);box-shadow:var(--shadow-1);'
      + 'padding:30px 34px}'
      + '.s4-checkout .ttl{font-size:19px;font-weight:640;color:var(--ink-2)}'
      + '.s4-checkout .field{margin-top:16px;height:16px;border-radius:5px;background:var(--surface-3)}'
      + '.s4-checkout .pay{margin-top:22px;height:44px;border-radius:var(--r-sm);background:var(--surface-3);'
      + 'display:flex;align-items:center;justify-content:center;color:var(--ink-3);font-size:14px;font-weight:600}'
      + '.s4-sheet{position:absolute;left:50%;width:620px;'
      + 'background:var(--surface);border-radius:22px;box-shadow:0 -20px 60px rgba(20,16,10,.35);'
      + 'padding:24px 32px 28px}'
      + '.s4-sheet .hd{display:flex;align-items:center;gap:11px;padding-bottom:16px;border-bottom:1px solid var(--line)}'
      + '.s4-sheet .spark{width:26px;height:26px;border-radius:8px;background:var(--brand);color:#fff;'
      + 'display:grid;place-items:center;font-size:14px;flex:none}'
      + '.s4-sheet .hd b{font-size:18px;font-weight:700;letter-spacing:-.01em}'
      + '.s4-sheet .chip{margin-top:16px;display:inline-block;font-family:var(--font-mono);font-size:11.5px;'
      + 'letter-spacing:.03em;background:var(--ok-soft);color:var(--ok);border:1px solid var(--ok-line);'
      + 'border-radius:999px;padding:4px 11px}'
      + '.s4-sheet label{display:block;margin-top:16px;font-family:var(--font-mono);font-size:10.5px;font-weight:700;'
      + 'letter-spacing:.07em;text-transform:uppercase;color:var(--ink-3)}'
      + '.s4-sheet .val{margin-top:6px;font-size:15px;color:var(--ink);background:var(--surface-2);'
      + 'border:1px solid var(--line);border-radius:9px;padding:10px 13px}'
      + '.s4-sheet .sum{margin-top:20px;background:var(--ink);color:var(--paper);border-radius:14px;padding:15px 18px;'
      + 'display:flex;justify-content:space-between;align-items:baseline}'
      + '.s4-sheet .sum b{font-size:21px;font-weight:700}'
      + '.s4-sheet .cta{margin-top:16px;background:var(--brand);color:#fff;font-weight:680;font-size:15px;'
      + 'text-align:center;border-radius:12px;padding:14px}'
      + '.s4-sheet .foot{margin-top:14px;font-size:11px;line-height:1.55;color:var(--ink-3)}'
      + '.s4-ingress{position:absolute;left:50%;top:92px;transform:translateX(-50%);display:flex;gap:12px}'
      + '.s4-ingress span{padding:12px 18px;border-radius:999px;background:#171614;color:#f7f3ed;font:12px var(--font-mono);letter-spacing:.05em;border:1px solid #37332f}'
      + '.s4-ingress span.on{background:var(--brand);border-color:#ff9b82}'

      + '.s4-bill{margin-top:96px;width:480px;background:var(--surface);border:1px solid var(--line);'
      + 'border-radius:10px;box-shadow:var(--shadow-2);padding:30px 32px 26px;position:relative;overflow:hidden}'
      + '.s4-bill .shop{text-align:center;font-weight:700;font-size:17px;letter-spacing:.02em}'
      + '.s4-bill .addr{text-align:center;font-size:11.5px;color:var(--ink-3);margin-top:3px}'
      + '.s4-bill .rule{margin:14px 0;border-top:1px dashed var(--line-2)}'
      + '.s4-bill .line{display:flex;justify-content:space-between;font-family:var(--font-mono);font-size:14px;'
      + 'padding:3px 0;color:var(--ink-2)}'
      + '.s4-bill .line.total{color:var(--ink);font-weight:700;font-size:16px;padding-top:8px}'
      + '.s4-bill .scan{position:absolute;left:0;right:0;height:44px;'
      + 'background:linear-gradient(rgba(255,92,53,0),rgba(255,92,53,.16) 45%,rgba(255,92,53,0));'
      + 'border-top:1.5px solid var(--brand);border-bottom:1.5px solid var(--brand)}'
      + '.s4-match{margin-top:20px;width:480px;background:var(--ok-soft);border:1px solid var(--ok-line);'
      + 'border-radius:var(--r);padding:16px 20px;text-align:center}'
      + '.s4-match .amt{font-family:var(--font-mono);font-size:22px;font-weight:700;color:var(--ok)}'
      + '.s4-match .note{margin-top:5px;font-size:12.5px;color:var(--ink-2)}';
    var style = el('style', '', document.head);
    style.textContent = css;
  }

  // -- content, all real (see file header for sources) -----------------------

  var SENTENCE = 'Dinner Saturday with Arsh and Maya near Koramangala, under ₹800 each';

  // Real venues near Koramangala, ranked — captured from a live local run of
  // `npm run e2e:plan` against the real ranker + real OpenStreetMap data
  // (2026-08-02). Addresses are the real `addr:street`-shaped tags Overpass
  // returned.
  var VENUES = [
    { rank: 1, name: 'Sukh Sagar', addr: 'Mahayogi Vemana Road', pct: 93 },
    { rank: 2, name: 'Nandhana', addr: 'Koramangala', pct: 92 },
    { rank: 3, name: 'Crazy Boys', addr: 'Koramangala', pct: 92 },
  ];

  var PRODUCT_URL = 'fashionnova.com/products/a-dollar-and-a-dream-short-sleeve-tee';

  var BILL_ROWS = [
    ['2x Margherita Pizza', '760.00'],
    ['1 Paneer Tikka', '380.00'],
    ['3 Basmati Blonde', '870.00'],
    ['Garlic Bread', '240.00'],
    ['Subtotal', '2250.00'],
    ['CGST 2.5%', '56.25'],
    ['SGST 2.5%', '56.25'],
    ['Service Charge', '225.00'],
  ];

  function mount(root) {
    injectStyle();
    root.style.background = 'var(--paper)';

    var els = {};

    // ---- Cut 1: say it ------------------------------------------------
    var c1 = el('div', 's4-cut', root);
    var e1 = el('div', 's4-eyebrow-row', c1);
    el('div', 'eyebrow', e1).textContent = 'SAY IT';
    var bar1 = el('div', 's4-bar', c1);
    el('span', 'glyph', bar1).textContent = '✨';
    var typed = el('span', 'txt', bar1);
    var caret1 = el('span', 's4-caret', bar1);
    var results = el('div', 's4-results', c1);
    var venueRows = VENUES.map(function (v) {
      var row = el('div', 's4-venue', results);
      row.style.opacity = '0';
      var rank = el('div', 'rank', row);
      rank.textContent = String(v.rank);
      var body = el('div', 'body', row);
      el('div', 'name', body).textContent = v.name;
      el('div', 'addr', body).textContent = v.addr;
      var pct = el('div', 'pct', row);
      pct.textContent = v.pct + '%';
      return row;
    });
    var map = el('div', 's4-map', c1);
    el('div', 'grid', map);
    var ring = el('div', 'ring', map);
    ring.style.width = '0px';
    ring.style.height = '0px';
    el('div', 'pin', map).style.opacity = '0';
    map.style.opacity = '0';

    // ---- Cut 2: paste a link -------------------------------------------
    var c2 = el('div', 's4-cut', root);
    var e2 = el('div', 's4-eyebrow-row', c2);
    el('div', 'eyebrow', e2).textContent = 'PASTE A LINK';
    var url = el('div', 's4-url', c2);
    el('span', 'glyph', url).textContent = '↩';
    var urlTxt = el('span', 'txt', url);
    urlTxt.textContent = PRODUCT_URL;
    var product = el('div', 's4-product', c2);
    product.style.opacity = '0';
    product.style.transform = 'translateY(14px)';
    var pimg = el('div', 'img', product);
    pimg.textContent = 'fashionnova.com';
    var pinfo = el('div', 'info', product);
    var prow1 = el('div', 'row1', pinfo);
    el('span', 'domain', prow1).textContent = 'fashionnova.com';
    el('span', 'badge', prow1).textContent = 'From the link';
    el('div', 'title', pinfo).textContent = 'A Dollar And A Dream Short Sleeve Tee';
    el('div', 'price', pinfo).textContent = '$13.99';
    el('div', 'cta', pinfo).textContent = 'Split this';

    // ---- Cut 3: the extension ------------------------------------------
    var c3 = el('div', 's4-cut', root);
    var ingress = el('div', 's4-ingress', c3);
    ['CHROME EXTENSION · ACTIVE','SHARED PAGE DETECTOR'].forEach(function (name, i) { var chip=el('span',i===0?'on':'',ingress);chip.textContent=name; });
    var checkout = el('div', 's4-checkout', c3);
    el('div', 'ttl', checkout).textContent = 'Checkout — Velvet Tickets';
    ['62%', '88%', '40%'].forEach(function (w) {
      var f = el('div', 'field', checkout);
      f.style.width = w;
    });
    el('div', 'pay', checkout).textContent = 'Pay ₹2,400.00';
    var sheet = el('div', 's4-sheet', c3);
    var shd = el('div', 'hd', sheet);
    el('div', 'spark', shd).textContent = '⚡';
    el('b', '', shd).textContent = 'Split this with sutra';
    el('div', 'chip', sheet).textContent = 'high confidence · 92%';
    el('label', '', sheet).textContent = 'What are you splitting';
    el('div', 'val', sheet).textContent = 'Velvet Tickets — GA';
    el('label', '', sheet).textContent = 'Who is paying';
    el('div', 'val', sheet).textContent = 'You, Arsh, Maya, Dev · 4 selected';
    var sum = el('div', 'sum', sheet);
    var suml = el('span', '', sum);
    suml.textContent = 'Total';
    var sumb = el('b', '', sum);
    sumb.textContent = '₹2,400.00';
    el('div', 'cta', sheet).textContent = 'Create group · 4';
    el('div', 'foot', sheet).textContent =
      'Importing a page does not authorize a merchant checkout. Each friend approves their own share on their own phone.';

    // ---- Cut 4: photograph a bill ---------------------------------------
    var c4 = el('div', 's4-cut', root);
    var e4 = el('div', 's4-eyebrow-row', c4);
    el('div', 'eyebrow', e4).textContent = 'PHOTOGRAPH A BILL';
    var bill = el('div', 's4-bill', c4);
    el('div', 'shop', bill).textContent = 'TOIT BREWPUB';
    el('div', 'addr', bill).textContent = '100 Feet Road, Indiranagar';
    el('div', 'rule', bill);
    var billLines = BILL_ROWS.map(function (r) {
      var line = el('div', 'line', bill);
      line.style.opacity = '0';
      var l = el('span', '', line);
      l.textContent = r[0];
      var v = el('span', '', line);
      v.textContent = r[1];
      return line;
    });
    el('div', 'rule', bill);
    var totalLine = el('div', 'line total', bill);
    totalLine.style.opacity = '0';
    el('span', '', totalLine).textContent = 'TOTAL';
    el('span', '', totalLine).textContent = '2587.50';
    var scan = el('div', 'scan', bill);
    scan.style.top = '-60px';
    var match = el('div', 's4-match', c4);
    match.style.opacity = '0';
    el('div', 'amt', match).textContent = '₹2,587.50 — matches the printed total';
    el('div', 'note', match).textContent =
      '4 item(s) ₹2,250.00 + 3 charge(s) ₹337.50 = ₹2,587.50, matching the printed total.';

    els.c1 = c1; els.c2 = c2; els.c3 = c3; els.c4 = c4;
    els.typed = typed; els.caret1 = caret1; els.venueRows = venueRows;
    els.map = map; els.ring = ring; els.pin = map.querySelector('.pin');
    els.urlTxt = urlTxt; els.product = product;
    els.sheet = sheet;
    els.bill = bill; els.billLines = billLines; els.totalLine = totalLine; els.scan = scan; els.match = match;

    root._els = els;
  }

  function drawCut1(t, E) {
    var FILM = window.FILM;
    var op = cutOpacity(t, 0, CUT);
    E.c1.style.opacity = String(op);
    if (op <= 0) return;

    var TYPE_START = 150;
    var typed = FILM.typewriter(SENTENCE, t - TYPE_START, 46);
    E.typed.textContent = typed;
    var done = typed.length >= SENTENCE.length;
    E.caret1.style.opacity = t < TYPE_START ? '0' : (Math.floor(t / 260) % 2 === 0 || done === false ? '1' : '0');
    if (done && t > TYPE_START + (SENTENCE.length / 46) * 1000 + 300) E.caret1.style.opacity = '0';

    var RESOLVE_AT = 1750;
    var mapIn = FILM.easeOut(FILM.progress(t, RESOLVE_AT, RESOLVE_AT + 300));
    E.map.style.opacity = String(mapIn);
    E.pin.style.opacity = String(FILM.progress(t, RESOLVE_AT + 120, RESOLVE_AT + 320));
    E.pin.style.transform = 'translate(-50%,' + FILM.lerp(-140, -100, FILM.easeOut(FILM.progress(t, RESOLVE_AT + 100, RESOLVE_AT + 420))) + '%) rotate(-45deg)';
    var ringR = FILM.lerp(0, 62, FILM.easeOut(FILM.progress(t, RESOLVE_AT + 200, RESOLVE_AT + 900)));
    E.ring.style.width = ringR + 'px';
    E.ring.style.height = ringR + 'px';
    E.ring.style.opacity = String(1 - FILM.progress(t, RESOLVE_AT + 200, RESOLVE_AT + 900));

    E.venueRows.forEach(function (row, i) {
      var at = 2050 + i * 160;
      var reveal = FILM.easeOut(FILM.progress(t, at, at + 260));
      row.style.opacity = String(reveal);
      row.style.transform = 'translateY(' + FILM.lerp(10, 0, reveal) + 'px)';
    });
  }

  function drawCut2(t2, E) {
    var FILM = window.FILM;
    var op = cutOpacity(t2, CUT, 2 * CUT);
    E.c2.style.opacity = String(op);
    if (op <= 0) return;
    var t = t2 - CUT; // cut-local time

    var pasteFlash = 1 - FILM.progress(t, 250, 650);
    E.urlTxt.style.background = 'color-mix(in srgb, var(--brand) ' + Math.round(pasteFlash * 35) + '%, transparent)';

    var reveal = FILM.easeOut(FILM.progress(t, 900, 1250));
    E.product.style.opacity = String(reveal);
    E.product.style.transform = 'translateY(' + FILM.lerp(14, 0, reveal) + 'px)';
  }

  function drawCut3(t3, E) {
    var FILM = window.FILM;
    var op = cutOpacity(t3, 2 * CUT, 3 * CUT);
    E.c3.style.opacity = String(op);
    if (op <= 0) return;
    var t = t3 - 2 * CUT;

    // Rest position is computed from the sheet's own measured height so its
    // footer always clears the fixed caption band (top 908px of the 1080
    // stage), regardless of content — never a hardcoded guess.
    var restTop = 908 - E.sheet.offsetHeight - 26;
    var slide = FILM.easeOut(FILM.progress(t, 260, 950));
    E.sheet.style.transform = 'translateX(-50%)';
    E.sheet.style.top = FILM.lerp(1080, restTop, slide) + 'px';
  }

  function drawCut4(t4, E) {
    var FILM = window.FILM;
    var op = cutOpacity(t4, 3 * CUT, 4 * CUT);
    E.c4.style.opacity = String(op);
    if (op <= 0) return;
    var t = t4 - 3 * CUT;

    var scanY = FILM.lerp(-60, 420, FILM.easeInOut(FILM.progress(t, 150, 1450)));
    E.scan.style.top = scanY + 'px';
    E.scan.style.opacity = String(1 - FILM.progress(t, 1250, 1550));

    E.billLines.forEach(function (line, i) {
      var lineTop = line.offsetTop;
      var passed = scanY + 44 >= lineTop || t >= 1450;
      var at = 150 + (i + 1) * 145; // stagger fallback, keeps monotonic reveal
      var reveal = FILM.easeOut(FILM.progress(t, Math.min(at, 1450), Math.min(at, 1450) + 200));
      line.style.opacity = passed ? String(Math.max(reveal, 0.999)) : '0';
    });
    var totalReveal = FILM.easeOut(FILM.progress(t, 1500, 1750));
    E.totalLine.style.opacity = String(totalReveal);

    var matchIn = FILM.easeOut(FILM.progress(t, 1850, 2150));
    E.match.style.opacity = String(matchIn);
    E.match.style.transform = 'translateY(' + FILM.lerp(8, 0, matchIn) + 'px)';
  }

  function draw(t, root) {
    var E = root._els;
    drawCut1(t, E);
    drawCut2(t, E);
    drawCut3(t, E);
    drawCut4(t, E);
  }

  window.FILM.register({
    id: 's4-surfaces',
    startMs: START,
    endMs: END,
    mount: mount,
    draw: draw,
  });

  window.FILM.caption('Real places from OpenStreetMap. Nothing invented.', START + 2100, START + CUT);
  window.FILM.caption("It reads the merchant's own data.", START + CUT + 950, START + 2 * CUT);
  window.FILM.caption('The Chrome extension detects the checkout and opens Sutra in-page.', START + 2 * CUT + 500, START + 3 * CUT);
  window.FILM.caption('Read on your device. The maths is checked against the paper.', START + 3 * CUT + 1900, START + 4 * CUT);
})();
