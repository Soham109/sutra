// sutra — film · Scene 7 · NANDA (2:00-2:25)
// --------------------------------------------------------------------------
// Two panes, same $186.00 group purchase, run for real:
//
//   Left  — prepaid_credits (NANDA Town's bundled plugin): three agents pay
//           the organiser directly; the only rail it has pools their money
//           into his own balance.
//   Right — prava_mandates (ours): four principals' own mandates are each
//           charged on their own card, straight to the merchant, never
//           through the organiser.
//
// Every name and number here is the real, live output of
// `npm run nanda:scene` (nanda-town-prava/scripts/town_scene.py), run twice
// (a throwaway venv and the project's own nanda-town-prava/.venv) with
// byte-identical results, and cross-checked against
// nanda-town-prava/scripts/town_scene.py's source:
//   Act 7 (prepaid_credits): Arsh, Dev, Priya each pay 6200 into Soham
//     directly -> Soham's own balance goes 0 -> 18600.
//   Act 2-4 (prava_mandates): Soham 6510, Arsh 6510, Dev DECLINED (0),
//     Maya backstop 5580 -> velvet-tickets receives the full 18600; no
//     agent's own balance ever moves.
// The four terminal lines are the literal, current console output of
// town_scene.py Act 4 (verified against the source in scripts/town_scene.py
// and against two independent runs) — not SCRIPT.md's own paraphrase of
// them, which turned out to have drifted from the script's real wording.

(function () {
  var START = 120000;
  var END = 145000;

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
  function initials(name) {
    return name.slice(0, 2).toUpperCase();
  }
  function money(n) {
    return '₹' + n.toLocaleString('en-US');
  }

  function injectStyle() {
    var css = ''
      + '#film-scene-s7-nanda{position:relative}'
      + '.s7-title{position:absolute;left:50%;top:66px;transform:translateX(-50%);text-align:center}'
      + '.s7-title .eyebrow{color:var(--brand-ink)}'
      + '.s7-title .sub{margin-top:6px;font-size:14px;color:var(--ink-3)}'

      + '.s7-panes{position:absolute;left:50%;top:150px;transform:translateX(-50%);width:1740px;height:660px;'
      + 'display:flex;gap:36px}'
      + '.s7-pane{width:852px;height:660px;background:var(--surface);border:1px solid var(--line);'
      + 'border-radius:var(--r-lg);box-shadow:var(--shadow-2);padding:26px 34px;position:relative;overflow:hidden}'
      + '.s7-pane .hd{text-align:center}'
      + '.s7-pane .hd .nm{font-family:var(--font-mono);font-size:19px;font-weight:700;letter-spacing:-.01em}'
      + '.s7-pane .hd .sb{margin-top:3px;font-size:12px;color:var(--ink-3)}'

      + '.s7-people{margin-top:26px;display:flex;justify-content:center;gap:26px}'
      + '.s7-person{text-align:center;opacity:0}'
      + '.s7-person .av{width:52px;height:52px;border-radius:999px;color:#fff;display:grid;place-items:center;'
      + 'font-size:16px;font-weight:700;margin:0 auto}'
      + '.s7-person .av.declined{background:var(--surface-3) !important;color:var(--ink-3);'
      + 'border:2px dashed var(--line-2)}'
      + '.s7-person .nm{margin-top:8px;font-size:13px;font-weight:640}'
      + '.s7-person .amt{margin-top:2px;font-family:var(--font-mono);font-size:12.5px;color:var(--ink-2)}'
      + '.s7-person .amt.declined{color:var(--bad)}'

      + '.s7-flow{position:relative;height:210px;margin-top:6px}'
      + '.s7-coin{position:absolute;top:0;width:12px;height:12px;border-radius:999px;background:var(--warn)}'
      + '.s7-line{position:absolute;top:0;width:3px;background:var(--ink-3);opacity:.35}'
      + '.s7-boundary{position:absolute;left:50%;top:56px;transform:translateX(-50%);width:760px;height:2px;'
      + 'border-top:2px dashed var(--line-2)}'
      + '.s7-boundary .lbl{position:absolute;left:50%;top:-11px;transform:translateX(-50%);background:var(--surface);'
      + 'padding:0 10px;font-family:var(--font-mono);font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;'
      + 'color:var(--ink-3)}'

      + '.s7-dest{margin-top:8px;display:flex;flex-direction:column;align-items:center;gap:6px}'
      + '.s7-dest .box{min-width:220px;text-align:center;border-radius:var(--r);padding:14px 22px;'
      + 'border:1px solid var(--line)}'
      + '.s7-dest .box .lbl{font-size:12px;color:var(--ink-3)}'
      + '.s7-dest .box .val{margin-top:3px;font-family:var(--font-mono);font-size:28px;font-weight:700}'
      + '.s7-dest .aside{font-size:12px;color:var(--ink-3)}'

      + '.s7-stamp{position:absolute;left:50%;bottom:30px;transform:translateX(-50%) scale(0.85);'
      + 'opacity:0;padding:10px 24px;border-radius:999px;font-family:var(--font-mono);font-size:15px;'
      + 'font-weight:750;letter-spacing:.04em;border:1.5px solid}'
      + '.s7-stamp.bad{background:var(--bad-soft);color:var(--bad);border-color:var(--bad-line)}'
      + '.s7-stamp.ok{background:var(--ok-soft);color:var(--ok);border-color:var(--ok-line)}'

      + '.s7-term{position:absolute;left:50%;top:230px;transform:translateX(-50%);width:1480px;height:430px;'
      + 'background:var(--ink);border:1px solid rgba(255,255,255,.08);border-radius:24px;box-shadow:var(--shadow-3);padding:68px 52px 34px;'
      + 'opacity:0}'
      + '.s7-term:before{content:"LIVE / PROTOCOL INTEGRATION";position:absolute;left:52px;top:25px;font-family:var(--font-mono);font-size:10px;letter-spacing:.14em;color:#77736c}'
      + '.s7-term:after{content:"●  ●  ●";position:absolute;right:40px;top:22px;font-size:13px;letter-spacing:5px;color:#ff5c35}'
      + '.s7-term .prompt{font-family:var(--font-mono);font-size:15px;color:var(--ink-3);margin-bottom:18px;padding-bottom:16px;border-bottom:1px solid #2b2926}'
      + '.s7-term .ln{font-family:var(--font-mono);font-size:18px;line-height:1.72;color:#e8e6df;'
      + 'white-space:pre-wrap}'
      + '.s7-term .ln .tag{color:var(--ok);font-weight:700}'
      + '.s7-caret{display:inline-block;width:10px;height:19px;background:#e8e6df;margin-left:1px;vertical-align:-3px}';
    var style = el('style', '', document.head);
    style.textContent = css;
  }

  // -- real content (see file header) -------------------------------------

  var LEFT_PEOPLE = [
    { name: 'Arsh', amt: 6200 },
    { name: 'Dev', amt: 6200 },
    { name: 'Priya', amt: 6200 },
  ];
  var RIGHT_PEOPLE = [
    { name: 'Soham', amt: 6510 },
    { name: 'Arsh', amt: 6510 },
    { name: 'Dev', amt: 0, declined: true },
    { name: 'Maya', amt: 5580, note: 'backstop' },
  ];

  // Verbatim, current console output of town_scene.py Act 4 (checked against
  // scripts/town_scene.py source and two independent live runs).
  var TERM_LINES = [
    'group committed despite a mid-flight decline — committed',
    'Dev was never charged',
    "Maya's backstop card absorbed exactly the shortfall the other two couldn't cover",
    "no_pooled_funds — no agent's headroom ever exceeds what it started with",
  ];

  var PEOPLE_IN_AT = 700;
  var FLOW_AT = 1500;
  var FLOW_DUR = 4200;
  var STAMP_AT = FLOW_AT + FLOW_DUR + 300;
  var PANES_OUT_AT = STAMP_AT + 1400;
  var TERM_IN_AT = PANES_OUT_AT + 500;
  var TERM_PROMPT = 'python scripts/town_scene.py';
  var TYPE_CPS = 60;
  var CAPTION_FROM = 17300;

  function buildPane(parent, name, sub) {
    var pane = el('div', 's7-pane', parent);
    var hd = el('div', 'hd', pane);
    el('div', 'nm', hd).textContent = name;
    el('div', 'sb', hd).textContent = sub;
    return pane;
  }

  function buildPeople(pane, list) {
    var wrap = el('div', 's7-people', pane);
    return list.map(function (p) {
      var person = el('div', 's7-person', wrap);
      var av = el('div', 'av' + (p.declined ? ' declined' : ''), person);
      if (!p.declined) av.style.background = accentFor(p.name);
      av.textContent = initials(p.name);
      el('div', 'nm', person).textContent = p.name;
      var amt = el('div', 'amt' + (p.declined ? ' declined' : ''), person);
      amt.textContent = p.declined ? 'declined' : money(p.amt) + (p.note ? ' · ' + p.note : '');
      return { cfg: p, el: person };
    });
  }

  function mount(root) {
    injectStyle();
    root.style.background = 'var(--paper)';

    var title = el('div', 's7-title', root);
    el('div', 'eyebrow', title).textContent = 'THE SAME ₹18,600 PURCHASE, RUN FOR REAL';

    var panes = el('div', 's7-panes', root);
    var leftPane = buildPane(panes, 'prepaid_credits', "NANDA Town's bundled plugin");
    var leftPeople = buildPeople(leftPane, LEFT_PEOPLE);
    var leftFlow = el('div', 's7-flow', leftPane);
    var leftCoins = LEFT_PEOPLE.map(function (_, i) {
      var c = el('div', 's7-coin', leftFlow);
      c.style.left = (140 + i * 290) + 'px';
      c.style.opacity = '0';
      return c;
    });
    var leftDest = el('div', 's7-dest', leftPane);
    var leftBox = el('div', 'box', leftDest);
    el('div', 'lbl', leftBox).textContent = "organiser Soham's own balance";
    var leftVal = el('div', 'val', leftBox);
    leftVal.textContent = '₹0';
    var leftStamp = el('div', 's7-stamp bad', leftPane);
    leftStamp.textContent = 'POOLED';

    var rightPane = buildPane(panes, 'prava_mandates', 'ours');
    var rightPeople = buildPeople(rightPane, RIGHT_PEOPLE);
    var rightFlow = el('div', 's7-flow', rightPane);
    var boundary = el('div', 's7-boundary', rightFlow);
    el('div', 'lbl', boundary).textContent = 'simulator boundary';
    var rightLines = RIGHT_PEOPLE.map(function (p, i) {
      var l = el('div', 's7-line', rightFlow);
      l.style.left = (98 + i * 190) + 'px';
      l.style.height = '0px';
      if (p.declined) l.style.opacity = '0';
      return l;
    });
    var rightDest = el('div', 's7-dest', rightPane);
    var rightBox = el('div', 'box', rightDest);
    el('div', 'lbl', rightBox).textContent = 'merchant velvet-tickets';
    var rightVal = el('div', 'val', rightBox);
    rightVal.textContent = '₹0';
    var rightAside = el('div', 'aside', rightDest);
    rightAside.textContent = "organiser Soham's own balance: +₹0";
    var rightStamp = el('div', 's7-stamp ok', rightPane);
    rightStamp.textContent = 'NO POOLED FUNDS';

    var term = el('div', 's7-term', root);
    var prompt = el('div', 'prompt', term);
    prompt.textContent = '$ ' + TERM_PROMPT;
    var termLines = TERM_LINES.map(function (text) {
      var ln = el('div', 'ln', term);
      ln.style.opacity = '0';
      return { text: text, el: ln };
    });

    // Resolve each terminal line's start/end once, off the static config.
    var cursor = TERM_IN_AT + 500;
    termLines.forEach(function (ln) {
      ln.startAt = cursor;
      ln.endAt = ln.startAt + (('[PASS] ' + ln.text).length / TYPE_CPS) * 1000;
      cursor = ln.endAt + 420;
    });

    root._els = {
      panes: panes, leftCoins: leftCoins, leftVal: leftVal, leftStamp: leftStamp,
      rightLines: rightLines, rightVal: rightVal, rightAside: rightAside, rightStamp: rightStamp,
      leftPeople: leftPeople, rightPeople: rightPeople,
      term: term, termLines: termLines,
    };
  }

  function draw(t, root) {
    var FILM = window.FILM;
    var E = root._els;

    var intro = FILM.easeOut(FILM.progress(t, 0, 500));
    root.querySelector('.s7-title').style.opacity = String(intro);

    var panesOut = FILM.easeIn(FILM.progress(t, PANES_OUT_AT, PANES_OUT_AT + 400));
    E.panes.style.opacity = String(intro * (1 - panesOut));
    E.panes.style.transform = 'translateX(-50%) translateY(' + FILM.lerp(0, -14, panesOut) + 'px)';

    E.leftPeople.concat(E.rightPeople).forEach(function (p, i) {
      var idx = i % 4;
      var at = PEOPLE_IN_AT + idx * 130;
      var reveal = FILM.easeOut(FILM.progress(t, at, at + 280));
      p.el.style.opacity = String(reveal);
    });

    // Left pane: coins arrive one at a time, counter steps up by 6200 each.
    var leftTotal = 0;
    LEFT_PEOPLE.forEach(function (p, i) {
      var at = FLOW_AT + i * (FLOW_DUR / LEFT_PEOPLE.length);
      var travel = FILM.easeIn(FILM.progress(t, at, at + 900));
      E.leftCoins[i].style.opacity = t < at ? '0' : String(1 - FILM.progress(t, at + 700, at + 900));
      E.leftCoins[i].style.top = FILM.lerp(0, 180, travel) + 'px';
      if (t >= at + 850) leftTotal += p.amt;
    });
    E.leftVal.textContent = money(leftTotal);

    // Right pane: a line grows from each card, straight through the
    // boundary, to the merchant. Dev's never grows — he declined.
    var rightTotal = 0;
    RIGHT_PEOPLE.forEach(function (p, i) {
      if (p.declined) return;
      var at = FLOW_AT + i * (FLOW_DUR / RIGHT_PEOPLE.length);
      var grow = FILM.easeOut(FILM.progress(t, at, at + 800));
      E.rightLines[i].style.height = FILM.lerp(0, 200, grow) + 'px';
      E.rightLines[i].style.opacity = String(grow);
      if (t >= at + 750) rightTotal += p.amt;
    });
    E.rightVal.textContent = money(rightTotal);

    var stampIn = FILM.easeOut(FILM.progress(t, STAMP_AT, STAMP_AT + 380));
    [E.leftStamp, E.rightStamp].forEach(function (s) {
      s.style.opacity = String(stampIn);
      s.style.transform = 'translateX(-50%) scale(' + FILM.lerp(0.85, 1, stampIn) + ')';
    });

    // Terminal.
    var termIn = FILM.easeOut(FILM.progress(t, TERM_IN_AT, TERM_IN_AT + 450));
    E.term.style.opacity = String(termIn);
    E.term.style.transform = 'translateX(-50%) translateY(' + FILM.lerp(14, 0, termIn) + 'px)';

    E.termLines.forEach(function (ln, i) {
      if (t < ln.startAt) {
        ln.el.style.opacity = '0';
        return;
      }
      ln.el.style.opacity = '1';
      var typed = FILM.typewriter('[PASS] ' + ln.text, t - ln.startAt, TYPE_CPS);
      ln.el.innerHTML = '';
      var tagLen = 7; // "[PASS] "
      if (typed.length <= tagLen) {
        var tagSpan = el('span', 'tag', ln.el);
        tagSpan.textContent = typed;
      } else {
        var tag = el('span', 'tag', ln.el);
        tag.textContent = typed.slice(0, tagLen);
        ln.el.appendChild(document.createTextNode(typed.slice(tagLen)));
      }
      var done = typed.length >= ('[PASS] ' + ln.text).length;
      if (!done) {
        var caret = el('span', 's7-caret', ln.el);
        caret.style.opacity = Math.floor(t / 260) % 2 === 0 ? '1' : '0';
      }
    });
  }

  window.FILM.register({
    id: 's7-nanda',
    startMs: START,
    endMs: END,
    mount: mount,
    draw: draw,
  });

  window.FILM.caption(
    'With our plugin installed, one agent cannot pay another. Money only leaves a card and reaches a merchant.',
    START + CAPTION_FROM,
    END
  );
})();
