// sutra — film · Scene 5 · PLANNING (1:22-1:42)
// --------------------------------------------------------------------------
// The one feature that is not about money. Three people answer on their
// phones; the board re-ranks live and prints its real reasons.
//
// Board and venues (Sukh Sagar / Nandhana / Crazy Boys, Koramangala, real
// addresses and scores) are the same live local run of `npm run e2e:plan`
// used in scene 4 cut 1 — same sentence, same real OpenStreetMap query.
// The three reason lines use the REAL template shapes the ranker actually
// emits (engine/src/plan/rank.ts: time_fit / travel_fit / budget_fit `why`
// strings — travel is genuinely kilometres, never minutes; budget is
// genuinely "within N of M shared budgets", never a bare "within budget"
// claim) rather than SCRIPT.md's illustrative paraphrase, which the real
// ranker cannot produce (no travel-time-in-minutes computation exists
// anywhere in the codebase). The rerank line is the literal, tested string
// from engine/test/plan-math.test.ts:1283 (`describeMove()`), applied to a
// real venue name from the live run in place of that test's fictional
// placeholder "Sablewood". The privacy line paraphrases the real copy in
// web/src/components/plan/budget.tsx.

(function () {
  var START = 82000;
  var END = 102000;

  function el(tag, className, parent) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (parent) parent.appendChild(e);
    return e;
  }

  // Same deterministic seed->colour mapping as web/src/lib/format.ts
  // accentFor(), reimplemented locally (each scene file is self-contained).
  var PALETTE = ['#2E2AD8', '#B7410E', '#12734F', '#7A2E8E', '#0F6C8C', '#A4231F', '#8A6D0B', '#3E5C2A'];
  function accentFor(seed) {
    var h = 0;
    for (var i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
    return PALETTE[Math.abs(h) % PALETTE.length];
  }
  function initials(name) {
    var parts = name.trim().split(/\s+/);
    return parts.length === 1 ? parts[0].slice(0, 2).toUpperCase() : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function injectStyle() {
    var css = ''
      + '#film-scene-s5-planning{position:relative}'
      + '.s5-eyebrow{position:absolute;left:50%;top:78px;transform:translateX(-50%);text-align:center}'
      + '.s5-eyebrow .eyebrow{color:var(--brand-ink)}'
      + '.s5-people{position:absolute;left:50%;top:126px;transform:translateX(-50%);display:flex;gap:22px}'
      + '.s5-chip{width:266px;background:var(--surface);border:1px solid var(--line);border-radius:var(--r);'
      + 'box-shadow:var(--shadow-1);padding:14px 16px;display:flex;gap:12px;align-items:flex-start}'
      + '.s5-chip .av{width:36px;height:36px;border-radius:999px;color:#fff;display:grid;place-items:center;'
      + 'font-size:13px;font-weight:700;flex:none}'
      + '.s5-chip .name{font-size:14.5px;font-weight:650}'
      + '.s5-chip .sig{margin-top:5px;font-size:11.5px;color:var(--ink-3);line-height:1.55}'
      + '.s5-chip .sig b{color:var(--ok);font-weight:700}'
      + '.s5-chip.maya-flash{box-shadow:0 0 0 2px var(--brand-line), var(--shadow-1)}'

      + '.s5-board{position:absolute;left:50%;top:290px;transform:translateX(-50%);width:1180px;height:400px}'
      + '.s5-row{position:absolute;left:0;width:1180px;height:104px;background:var(--surface);'
      + 'border:1px solid var(--line);border-radius:var(--r);box-shadow:var(--shadow-1);'
      + 'padding:16px 24px;display:flex;align-items:center;gap:22px}'
      + '.s5-row.top{border-color:var(--brand-line);box-shadow:0 0 0 2px var(--brand-soft), var(--shadow-1)}'
      + '.s5-row .rank{width:38px;height:38px;border-radius:999px;background:var(--surface-2);color:var(--ink-2);'
      + 'display:grid;place-items:center;font-family:var(--font-mono);font-size:14px;font-weight:650;flex:none}'
      + '.s5-row .body{flex:1;min-width:0}'
      + '.s5-row .top1{display:flex;align-items:baseline;gap:10px}'
      + '.s5-row .name{font-size:19px;font-weight:640;letter-spacing:-0.008em}'
      + '.s5-row .addr{font-size:12.5px;color:var(--ink-3)}'
      + '.s5-row .why{margin-top:6px;font-size:13px;color:var(--ink-2);display:flex;gap:8px;align-items:baseline}'
      + '.s5-row .why .lbl{font-family:var(--font-mono);font-size:10px;letter-spacing:.06em;text-transform:uppercase;'
      + 'color:var(--brand-ink);flex:none}'
      + '.s5-row .pct{font-family:var(--font-mono);font-size:19px;font-weight:650;color:var(--brand-ink);flex:none}'

      + '.s5-move{position:absolute;left:50%;top:718px;transform:translateX(-50%);width:1180px;'
      + 'background:var(--brand-soft);border:1px solid var(--brand-line);border-radius:var(--r);'
      + 'padding:14px 22px;text-align:center;font-size:16.5px;color:var(--brand-ink);font-weight:560}'
      + '.s5-move b{font-weight:750}'

      + '.s5-privacy{position:absolute;left:50%;top:800px;transform:translateX(-50%);width:820px;'
      + 'text-align:center;font-size:13.5px;color:var(--ink-3);line-height:1.6}';
    var style = el('style', '', document.head);
    style.textContent = css;
  }

  // -- real content ------------------------------------------------------
  // Same three participants, same sentence, same live-captured venues as
  // scene 4 cut 1 (npm run e2e:plan, local engine, real OpenStreetMap).

  var PEOPLE = [
    { name: 'Soham', sig: '<b>✓</b> free 8:00–10:30pm · Koramangala' },
    { name: 'Arsh', sig: '<b>✓</b> free 8:00–11:30pm · Indiranagar' },
    { name: 'Maya', sig: '<b>✓</b> free 7:30–10:00pm · Jayanagar' },
  ];

  // Real venue rows. `why` uses the real rank.ts factor-`why` template
  // shapes verbatim (see file header) with the real numbers from the live
  // run; `label` mirrors the real FACTOR_LABEL used in
  // web/src/components/plan/model.ts.
  var ROWS = [
    {
      id: 'sukh-sagar', name: 'Sukh Sagar', addr: 'Mahayogi Vemana Road', pct: 93,
      label: 'Time', why: '3 of 3 who shared availability can make it — Sat, 8:00–10:30pm.',
    },
    {
      id: 'nandhana', name: 'Nandhana', addr: 'Koramangala', pct: 92,
      label: 'Travel', why: 'Average trip 3.7 km, longest 5.7 km (Maya).',
    },
    {
      id: 'crazy-boys', name: 'Crazy Boys', addr: 'Koramangala', pct: 92,
      label: 'Budget', why: '₹800.00 per person; within 3 of 3 shared budgets.',
    },
  ];

  var ROW_H = 104, ROW_GAP = 16;
  function slotY(i) { return i * (ROW_H + ROW_GAP); }

  // rank order before/after the reorder event, by row id
  var ORDER_BEFORE = ['sukh-sagar', 'nandhana', 'crazy-boys'];
  var ORDER_AFTER = ['nandhana', 'sukh-sagar', 'crazy-boys'];

  var MAYA_FLASH_AT = 10300;
  var REORDER_AT = 11400;
  var REORDER_DUR = 750;
  var MOVE_LINE_AT = REORDER_AT + 250;
  var CAPTION_FROM = 14200;

  function mount(root) {
    injectStyle();
    root.style.background = 'var(--paper)';

    var eyebrowWrap = el('div', 's5-eyebrow', root);
    el('div', 'eyebrow', eyebrowWrap).textContent = 'PLANNING';

    var peopleWrap = el('div', 's5-people', root);
    var chips = PEOPLE.map(function (p) {
      var chip = el('div', 's5-chip', peopleWrap);
      chip.style.opacity = '0';
      var av = el('div', 'av', chip);
      av.style.background = accentFor(p.name);
      av.textContent = initials(p.name);
      var body = el('div', '', chip);
      el('div', 'name', body).textContent = p.name;
      var sig = el('div', 'sig', body);
      sig.innerHTML = p.sig;
      return { cfg: p, el: chip };
    });

    var board = el('div', 's5-board', root);
    var rows = ROWS.map(function (r) {
      var row = el('div', 's5-row', board);
      row.style.opacity = '0';
      var rank = el('div', 'rank', row);
      var bodyWrap = el('div', 'body', row);
      var top1 = el('div', 'top1', bodyWrap);
      el('div', 'name', top1).textContent = r.name;
      el('div', 'addr', top1).textContent = r.addr;
      var why = el('div', 'why', bodyWrap);
      why.style.opacity = '0';
      el('span', 'lbl', why).textContent = r.label;
      el('span', '', why).textContent = r.why;
      var pct = el('div', 'pct', row);
      pct.textContent = r.pct + '%';
      return { cfg: r, el: row, rank: rank, why: why };
    });

    var moveLine = el('div', 's5-move', root);
    moveLine.style.opacity = '0';
    moveLine.innerHTML = '<b>Nandhana</b> moved from 2nd to 1st — Maya can now make it.';

    var privacy = el('div', 's5-privacy', root);
    privacy.style.opacity = '0';
    privacy.textContent =
      'Nobody sees this number, not even the organiser. It only decides what gets suggested — the ranker reads it, nobody else does.';

    root._els = { chips: chips, rows: rows, moveLine: moveLine, privacy: privacy };
  }

  function draw(t, root) {
    var FILM = window.FILM;
    var E = root._els;

    var intro = FILM.easeOut(FILM.progress(t, 0, 500));
    root.querySelector('.s5-eyebrow').style.opacity = String(intro);

    E.chips.forEach(function (chip, i) {
      var at = 250 + i * 180;
      var reveal = FILM.easeOut(FILM.progress(t, at, at + 320));
      chip.el.style.opacity = String(reveal);
      chip.el.style.transform = 'translateY(' + FILM.lerp(10, 0, reveal) + 'px)';
      var flashing = chip.cfg.name === 'Maya' && t >= MAYA_FLASH_AT && t < REORDER_AT + 200;
      chip.el.className = 's5-chip' + (flashing ? ' maya-flash' : '');
    });

    // Rank order is a pure function of t: before REORDER_AT it's ORDER_BEFORE,
    // after REORDER_AT + REORDER_DUR it's ORDER_AFTER, and in between every
    // row's `top` is eased between its old and new slot — recomputed fresh
    // every call, never accumulated.
    var swing = FILM.easeInOut(FILM.progress(t, REORDER_AT, REORDER_AT + REORDER_DUR));
    E.rows.forEach(function (row) {
      var fromIdx = ORDER_BEFORE.indexOf(row.cfg.id);
      var toIdx = ORDER_AFTER.indexOf(row.cfg.id);
      var y = FILM.lerp(slotY(fromIdx), slotY(toIdx), swing);
      row.el.style.top = y + 'px';
      var isTopNow = swing < 0.5 ? fromIdx === 0 : toIdx === 0;
      row.el.className = 's5-row' + (isTopNow ? ' top' : '');
      row.rank.textContent = String(Math.round(FILM.lerp(fromIdx, toIdx, swing)) + 1);

      var at = 900 + fromIdx * 600;
      var reveal = FILM.easeOut(FILM.progress(t, at, at + 320));
      row.el.style.opacity = String(reveal);
      row.el.style.transform = 'translateY(0)';
      var whyReveal = FILM.easeOut(FILM.progress(t, at + 380, at + 640));
      row.why.style.opacity = String(whyReveal);
    });

    var moveIn = FILM.easeOut(FILM.progress(t, MOVE_LINE_AT, MOVE_LINE_AT + 320));
    E.moveLine.style.opacity = String(moveIn);
    E.moveLine.style.transform = 'translateX(-50%) translateY(' + FILM.lerp(8, 0, moveIn) + 'px)';

    var privacyIn = FILM.easeOut(FILM.progress(t, CAPTION_FROM - 200, CAPTION_FROM + 300));
    E.privacy.style.opacity = String(privacyIn);
  }

  window.FILM.register({
    id: 's5-planning',
    startMs: START,
    endMs: END,
    mount: mount,
    draw: draw,
  });

  window.FILM.caption(
    'It says why. Budgets stay private — the ranker sees them, nobody else does.',
    START + CAPTION_FROM,
    END
  );
})();
