// sutra — film · Scene 6 · THE THREAD, AND @sutra (1:42-2:00)
// --------------------------------------------------------------------------
// A group thread, then @sutra answers from real state, then refuses to move
// money. The refusal is the most important frame in the feature tour — held
// far longer than anything else here, per SCRIPT.md.
//
// The bot copy is verified straight from source, not from SCRIPT.md's own
// paraphrase (which turned out to be stale):
//   - PAYMENT_REFUSAL is the literal, current, tested constant in
//     engine/src/messages/bot.ts:91-94, asserted verbatim by
//     engine/test/messages-bot.test.ts's "the payment boundary" tests.
//   - The "who hasn't answered" line follows the real shape of
//     describeGroupWho() (bot.ts:458-470) — "{approved} have approved;
//     still waiting on {pending}." — proven by
//     engine/test/messages-bot.test.ts:329-337 (members Dev=approved,
//     Sana=invited -> "Dev has approved... Sana"). SCRIPT.md's composite
//     "Waiting on Dev. Maya answered 20 minutes ago." is not one literal
//     bot string; it stitches that real sentence with a chat row's own
//     relativeTime() stamp (web/src/lib/format.ts, "Nm ago" shape) — shown
//     here as two genuine, separate mechanisms instead of one invented one.
// Chat chrome (bot row styling, composer hint, mention convention) mirrors
// web/src/components/chat/ChatThread.tsx.

(function () {
  var START = 102000;
  var END = 120000;

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
    var parts = name.trim().split(/\s+/);
    return parts.length === 1 ? parts[0].slice(0, 2).toUpperCase() : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function injectStyle() {
    var css = ''
      + '#film-scene-s6-thread{position:relative}'
      + '.s6-panel{position:absolute;left:50%;top:96px;transform:translateX(-50%);width:1080px;height:790px;'
      + 'background:var(--surface);border:1px solid var(--line);border-radius:var(--r-lg);'
      + 'box-shadow:var(--shadow-2);display:flex;flex-direction:column;overflow:hidden}'
      + '.s6-head{padding:20px 28px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between}'
      + '.s6-head .t{font-size:15px;font-weight:650}'
      + '.s6-head .s{font-size:12px;color:var(--ink-3);margin-top:2px}'
      + '.s6-dot{width:7px;height:7px;border-radius:999px;background:var(--ok);display:inline-block;margin-right:6px}'
      + '.s6-body{position:relative;flex:1;overflow:hidden;padding:0 28px}'
      + '.s6-scroll{position:relative;padding:22px 0;will-change:transform}'
      + '.s6-row{display:flex;gap:13px;margin-bottom:20px;align-items:flex-start}'
      + '.s6-av{width:38px;height:38px;border-radius:999px;color:#fff;display:grid;place-items:center;'
      + 'font-size:13px;font-weight:700;flex:none}'
      + '.s6-av.bot{background:var(--brand)}'
      + '.s6-bub-wrap{min-width:0;max-width:760px}'
      + '.s6-line-head{display:flex;align-items:baseline;gap:9px;margin-bottom:4px}'
      + '.s6-name{font-size:13.5px;font-weight:650}'
      + '.s6-name.is-bot{color:var(--brand-ink)}'
      + '.s6-time{font-size:11.5px;color:var(--ink-3)}'
      + '.s6-text{font-size:16px;line-height:1.55;color:var(--ink)}'
      + '.s6-text .mention{font-family:var(--font-mono);color:var(--brand-ink);font-weight:650}'
      + '.s6-row.refusal .s6-bub-wrap{max-width:820px}'
      + '.s6-row.refusal .s6-text{background:var(--brand-soft);border:1px solid var(--brand-line);'
      + 'border-radius:14px;padding:18px 22px;font-size:18px;line-height:1.6;color:var(--ink)}'
      + '.s6-caret{display:inline-block;width:2px;height:19px;background:var(--brand);margin-left:1px;vertical-align:-4px}'
      + '.s6-composer{padding:16px 28px 22px;border-top:1px solid var(--line);display:flex;align-items:center;gap:12px}'
      + '.s6-composer .fld{flex:1;height:46px;border-radius:999px;background:var(--surface-2);'
      + 'border:1px solid var(--line);display:flex;align-items:center;padding:0 18px;color:var(--ink-3);font-size:14px}'
      + '.s6-composer .fld b{font-family:var(--font-mono);color:var(--brand-ink);font-weight:650}';
    var style = el('style', '', document.head);
    style.textContent = css;
  }

  // -- real content (see file header for sources) ------------------------

  var TYPE_CPS = 32;

  var PAYMENT_REFUSAL =
    "I don't touch payments — I can't approve a mandate, charge a card, or accept anyone's share. " +
    'That only happens when a person completes it themselves, on their own device. ' +
    "I can tell you who's approved so far, or what the numbers are, if that helps.";

  var WHO_REPLY = 'Maya has approved; still waiting on Dev.';

  // rows: casual thread, then the two @sutra exchanges. `type` distinguishes
  // a plain human row from a typed-live row (typewriter) from the bot rows.
  var ROWS = [
    { type: 'human', who: 'Arsh', text: "table's booked for 8, see you all there", time: '24m ago', at: 250 },
    { type: 'human', who: 'Maya', text: 'omw!', time: '20m ago', at: 650 },
    { type: 'typed', who: 'Ada', text: '@sutra who hasn’t answered?', mention: true, at: 1900, cps: 32 },
    { type: 'bot', who: 'sutra', text: WHO_REPLY, time: 'now', at: -1 /* computed */ },
    { type: 'typed', who: 'Dev', text: '@sutra just pay for me', mention: true, at: -1 },
    { type: 'bot', who: 'sutra', text: PAYMENT_REFUSAL, time: 'now', at: -1, refusal: true },
  ];

  function mount(root) {
    injectStyle();
    root.style.background = 'var(--paper)';

    var actors = el('div', 's6-actors', root);
    var ada = window.FILM.character(actors, { key: 'ada', name: 'Ada', shirt: '#ff5c35', skin: '#9b6042', hair: '#241814', glasses: true });
    var dev = window.FILM.character(actors, { key: 'dev', name: 'Dev', shirt: '#b72b2b', skin: '#7e472e', hair: '#17120f', glasses: true });
    ada.classList.add('s6-actor-ada'); dev.classList.add('s6-actor-dev');
    var orb = el('div', 's6-agent-orb', root);
    el('div', 's6-orb-ring r1', orb);
    el('div', 's6-orb-ring r2', orb);
    el('div', 's6-orb-core', orb).textContent = '✦';
    el('div', 's6-orb-label', orb).textContent = 'SUTRA · READ ONLY';

    var panel = el('div', 's6-panel', root);
    panel.style.opacity = '0';
    var head = el('div', 's6-head', panel);
    var headL = el('div', '', head);
    el('div', 't', headL).textContent = 'goa trip ✈️ · thread';
    var sub = el('div', 's', headL);
    sub.innerHTML = '<span class="s6-dot"></span>live';
    el('div', 's', head).textContent = 'Ada, Arsh, Maya, Dev';

    var body = el('div', 's6-body', panel);
    var scroll = el('div', 's6-scroll', body);

    var rows = ROWS.map(function (cfg) {
      var isBot = cfg.type === 'bot';
      var rowEl = el('div', 's6-row' + (cfg.refusal ? ' refusal' : ''), scroll);
      rowEl.style.opacity = '0';
      var av = el('div', 's6-av' + (isBot ? ' bot' : ''), rowEl);
      if (!isBot) av.style.background = accentFor(cfg.who);
      av.textContent = isBot ? '✨' : initials(cfg.who);
      var wrap = el('div', 's6-bub-wrap', rowEl);
      var lh = el('div', 's6-line-head', wrap);
      var nameEl = el('span', 's6-name' + (isBot ? ' is-bot' : ''), lh);
      nameEl.textContent = cfg.who;
      var timeEl = el('span', 's6-time', lh);
      timeEl.textContent = cfg.time || '';
      var textEl = el('div', 's6-text', wrap);
      var caret = null;
      if (cfg.type === 'typed') {
        caret = el('span', 's6-caret', textEl);
      } else {
        textEl.textContent = cfg.text;
      }
      return { cfg: cfg, el: rowEl, textEl: textEl, caret: caret, timeEl: timeEl };
    });

    // Resolve dependent timings: each bot/typed row after the first fires
    // relative to when the row before it finishes, computed once here (pure
    // arithmetic over the static config, not over time) so draw() only ever
    // reads fixed numbers.
    rows[2].startAt = 1900;
    rows[2].endAt = rows[2].startAt + (rows[2].cfg.text.length / TYPE_CPS) * 1000;
    rows[3].startAt = rows[2].endAt + 500;
    rows[3].endAt = rows[3].startAt + 260;
    rows[4].startAt = rows[3].endAt + 1400;
    rows[4].endAt = rows[4].startAt + (rows[4].cfg.text.length / TYPE_CPS) * 1000;
    rows[5].startAt = rows[4].endAt + 500;
    rows[5].endAt = rows[5].startAt + 320;

    var composer = el('div', 's6-composer', panel);
    var fld = el('div', 'fld', composer);
    fld.innerHTML = 'Message the group… try <b>@sutra</b>';

    root._els = { panel: panel, body: body, scroll: scroll, rows: rows, actors: actors, ada: ada, dev: dev, orb: orb };
  }

  function renderTyped(row, t) {
    var FILM = window.FILM;
    var txt = FILM.typewriter(row.cfg.text, t - row.startAt, TYPE_CPS);
    if (row.cfg.mention) {
      var atIdx = txt.indexOf('@sutra');
      if (atIdx === -1) {
        row.textEl.textContent = '';
        row.textEl.appendChild(document.createTextNode(txt));
      } else {
        row.textEl.textContent = '';
        row.textEl.appendChild(document.createTextNode(txt.slice(0, atIdx)));
        var m = el('span', 'mention', row.textEl);
        m.textContent = txt.slice(atIdx, Math.min(txt.length, atIdx + 6));
        if (txt.length > atIdx + 6) row.textEl.appendChild(document.createTextNode(txt.slice(atIdx + 6)));
      }
    } else {
      row.textEl.textContent = txt;
    }
    if (row.caret) row.textEl.appendChild(row.caret);
    var done = txt.length >= row.cfg.text.length;
    row.caret.style.opacity = done ? '0' : (Math.floor(t / 260) % 2 === 0 ? '1' : '0');
  }

  function draw(t, root) {
    var FILM = window.FILM;
    var E = root._els;

    var intro = FILM.easeOut(FILM.progress(t, 0, 500));
    E.panel.style.opacity = String(intro);
    E.panel.style.transform = 'translateX(-50%) translateY(' + FILM.lerp(14, 0, intro) + 'px)';
    E.actors.style.opacity = String(intro);
    var refusalAt = E.rows[5].startAt;
    var react = FILM.easeOut(FILM.progress(t, refusalAt, refusalAt + 500));
    E.dev.style.transform = 'translateY(' + FILM.lerp(0, 18, react) + 'px) rotate(' + FILM.lerp(0, 4, react) + 'deg) scale(.72)';
    E.dev.querySelector('.film-person-mouth').style.borderBottom = react < .2 ? '3px solid rgb(73 35 27 / .72)' : '0';
    E.dev.querySelector('.film-person-mouth').style.borderTop = react < .2 ? '0' : '3px solid rgb(73 35 27 / .72)';
    E.ada.style.transform = 'translateY(' + (Math.sin(t / 900) * 2) + 'px) scale(.72)';
    var botActive = (t >= E.rows[3].startAt && t < E.rows[4].startAt) || t >= E.rows[5].startAt;
    var orbPulse = botActive ? .5 + Math.sin(t / 170) * .5 : .15 + Math.sin(t / 500) * .08;
    E.orb.style.opacity = String(intro);
    E.orb.style.transform = 'translateX(-50%) scale(' + (1 + orbPulse * .08) + ')';
    E.orb.style.filter = 'drop-shadow(0 0 ' + (16 + orbPulse * 30) + 'px rgb(255 92 53 / .72))';

    E.rows.forEach(function (row) {
      var cfg = row.cfg;
      if (cfg.type === 'human') {
        var reveal = FILM.easeOut(FILM.progress(t, cfg.at, cfg.at + 260));
        row.el.style.opacity = String(reveal);
        row.el.style.transform = 'translateY(' + FILM.lerp(8, 0, reveal) + 'px)';
        return;
      }
      if (t < row.startAt) {
        row.el.style.opacity = '0';
        return;
      }
      var reveal2 = FILM.easeOut(FILM.progress(t, row.startAt, row.startAt + 200));
      row.el.style.opacity = String(reveal2);
      row.el.style.transform = 'translateY(0)';

      if (cfg.type === 'typed') {
        renderTyped(row, t);
      } else {
        row.textEl.textContent = cfg.text;
      }
    });

    // Auto-scroll: keep the most recently revealed row's bottom in view —
    // same measured-DOM technique as scene 1, stable under any seek order.
    var last = null;
    E.rows.forEach(function (row) {
      var visibleAt = row.cfg.type === 'human' ? row.cfg.at : row.startAt;
      if (t >= visibleAt) last = row;
    });
    if (last) {
      var bottom = last.el.offsetTop + last.el.offsetHeight;
      var maxScroll = Math.max(0, E.scroll.scrollHeight - E.body.clientHeight);
      var desired = Math.max(0, bottom - E.body.clientHeight + 24);
      var offset = -Math.min(desired, maxScroll);
      E.scroll.style.transform = 'translateY(' + offset + 'px)';
    }
  }

  window.FILM.register({
    id: 's6-thread',
    startMs: START,
    endMs: END,
    mount: mount,
    draw: draw,
  });

  // The refusal caption arrives once the refusal bubble has fully typed in
  // and holds for the rest of the scene — deliberately the longest caption
  // hold anywhere in the film.
  window.FILM.caption(
    'The agent does the chasing. It can never do the paying.',
    START + 7300,
    END
  );
})();
