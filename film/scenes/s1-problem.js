// sutra — film · Scene 1 · THE PROBLEM (0:00-0:28)
// --------------------------------------------------------------------------
// A phone, centred, real proportions. A group chat that slowly turns
// awkward. No product, no logo, no UI chrome — just the thing everyone has
// lived. This scene carries the whole film; it should feel faintly
// embarrassing to watch.
//
// Everything below is driven by localT alone. mount() builds the static
// phone/chat DOM once (every row that will ever appear exists from frame
// one, at opacity 0); draw(localT) sets opacity/height/text/scroll purely
// from localT, so a cold seek(20000) paints identically to seek(0) then
// seek(20000).

(function () {
  var START = 0;
  var END = 28000;

  // Chronological rows of the "goa trip ✈️" chat. `at` is the localT a row
  // starts revealing; `outAt` (typing indicator only) is when it is gone
  // again with nothing left behind, exactly as the script asks for.
  var ROWS = [
    { type: 'date', text: 'Tuesday', at: 800 },
    { type: 'system', text: 'Booking confirmed · Goa bus ×4 · ₹9,600', at: 1400 },
    { type: 'sent', who: 'Ada', text: 'booked! 2400 each 🙏', at: 2600, style: 'primary' },
    { type: 'received', who: 'Arsh', text: 'sent!', at: 3800, tick: '✓' },
    { type: 'received', who: 'Maya', text: 'paying tonight!', at: 5200, tick: '🕐' },
    { type: 'received', who: 'Dev', text: 'remind me tomorrow', at: 6600, tick: '🕐' },
    { type: 'typing', who: 'Priya', at: 7800, outAt: 9200 },
    { type: 'date', text: 'Thursday', at: 10800 },
    { type: 'sent', who: 'Ada', text: 'hey', at: 11600, degrade: 1 },
    { type: 'date', text: 'Sunday', at: 14200 },
    { type: 'sent', who: 'Ada', text: 'sorry to ask again 😅', at: 15000, degrade: 2 },
    { type: 'date', text: 'Thursday', at: 18200 },
    { type: 'sent', who: 'Ada', text: 'guys?', at: 19000, degrade: 3 },
    { type: 'sent', who: 'Ada', text: 'pls 🙏', at: 20400, degrade: 4 },
  ];

  var PAID_AT = 3800; // Arsh's "sent!" is the only reply that ever actually lands
  var TALLY_AT = 21200; // counter crossfades from the running tally to the final one
  var TALLY_DONE = 21800;

  var DEGRADE = {
    1: { fontSize: '14px', color: 'var(--ink)', bg: 'var(--surface-2)', border: '1px solid var(--line)' },
    2: { fontSize: '13px', color: 'var(--ink-2)', bg: 'var(--surface-2)', border: '1px solid var(--line)' },
    3: { fontSize: '12.5px', color: 'var(--ink-3)', bg: 'transparent', border: '1px solid var(--line)' },
    4: { fontSize: '12px', color: 'var(--ink-3)', bg: 'transparent', border: '1px dashed var(--line)' },
  };

  function el(tag, className, parent) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (parent) parent.appendChild(e);
    return e;
  }

  function mount(root) {
    root.style.background = 'var(--paper)';

    var phoneWrap = el('div', '', root);
    phoneWrap.style.cssText = 'position:absolute;left:50%;top:50%;transform-origin:center center;';

    var phone = el('div', 'film-phone', phoneWrap);
    var notch = el('div', 'film-phone-notch', phone);
    var screen = el('div', 'film-phone-screen', phone);
    var status = el('div', 'film-phone-status', screen);
    status.innerHTML = '<span>9:41</span><span>●●●●  📶  🔋</span>';

    var header = el('div', 'film-chat-header', screen);
    var avatar = el('div', 'film-chat-avatar', header);
    avatar.textContent = '✈️';
    var headText = el('div', '', header);
    el('div', 'film-chat-title', headText).textContent = 'goa trip ✈️';
    el('div', 'film-chat-sub', headText).textContent = 'Ada, Arsh, Maya, Dev, Priya';

    var body = el('div', 'film-chat-body', screen);
    var scroll = el('div', 'film-chat-scroll', body);

    var rows = ROWS.map(function (cfg) {
      var rowEl;
      var refs = {};
      if (cfg.type === 'date') {
        rowEl = el('div', 'film-row film-row-date', scroll);
        var chip = el('div', 'film-date-chip', rowEl);
        chip.textContent = cfg.text;
      } else if (cfg.type === 'system') {
        rowEl = el('div', 'film-row film-row-msg sent', scroll);
        var sysBubble = el('div', 'film-bubble system', rowEl);
        sysBubble.textContent = cfg.text;
      } else if (cfg.type === 'sent') {
        rowEl = el('div', 'film-row film-row-msg sent', scroll);
        var sentBubble = el('div', 'film-bubble ' + (cfg.style === 'primary' ? 'sent-primary' : 'sent-muted'), rowEl);
        sentBubble.textContent = cfg.text;
        refs.bubble = sentBubble;
      } else if (cfg.type === 'received') {
        rowEl = el('div', 'film-row film-row-msg received', scroll);
        var name = el('div', 'film-sender', rowEl);
        name.textContent = cfg.who;
        var recvWrap = el('div', '', rowEl);
        recvWrap.style.cssText = 'display:flex;align-items:center;gap:7px;';
        var recvBubble = el('div', 'film-bubble received', recvWrap);
        recvBubble.textContent = cfg.text;
        var tick = el('span', 'film-tick', recvWrap);
        tick.textContent = cfg.tick || '';
        refs.tick = tick;
      } else if (cfg.type === 'typing') {
        rowEl = el('div', 'film-row film-typing-row', scroll);
        var name2 = el('div', 'film-sender', rowEl);
        name2.textContent = cfg.who;
        var typingBubble = el('div', 'film-typing-bubble', rowEl);
        refs.dots = [0, 1, 2].map(function () { return el('span', 'film-typing-dot', typingBubble); });
        // Measure the row's natural height now, before draw() ever
        // constrains it, so the grow/shrink in draw() targets its real
        // content height instead of a guessed pixel value.
        refs.naturalHeight = rowEl.scrollHeight;
      }
      rowEl.style.opacity = '0';
      return { cfg: cfg, el: rowEl, refs: refs };
    });

    // Counter HUD, top-right of the frame.
    var hud = el('div', 'film-stat-hud', root);
    var hudRunning = el('div', '', hud);
    el('div', 'eyebrow', hudRunning).textContent = 'collected';
    var hudValue = el('div', 'film-stat-value amount', hudRunning);
    var hudFinal = el('div', 'film-stat-final', hud);
    var hudOut = el('div', 'film-stat-line amount', hudFinal);
    var hudDays = el('div', 'film-stat-line amount', hudFinal);
    var hudReminders = el('div', 'film-stat-line amount', hudFinal);
    hudFinal.style.position = 'absolute';
    hudFinal.style.top = '0';
    hudFinal.style.right = '0';
    hudFinal.style.opacity = '0';

    root._els = {
      phoneWrap: phoneWrap,
      screen: screen,
      body: body,
      scroll: scroll,
      rows: rows,
      hud: hud,
      hudRunning: hudRunning,
      hudValue: hudValue,
      hudFinal: hudFinal,
      hudOut: hudOut,
      hudDays: hudDays,
      hudReminders: hudReminders,
    };
  }

  function draw(t, root) {
    var E = root._els;
    var FILM = window.FILM;

    // Phone entrance: fades and settles in over the first half second. The
    // phone is big enough now (866px of the 1080 stage) that centring it on
    // the full frame would run it under the caption band; -76px recentres
    // it in the room actually left above that band.
    var intro = FILM.easeOut(FILM.progress(t, 0, 500));
    E.phoneWrap.style.opacity = String(intro);
    E.phoneWrap.style.transform =
      'translate(-50%, calc(-50% - 76px)) translateY(' + FILM.lerp(18, 0, intro) + 'px) scale(' + FILM.lerp(0.97, 1, intro) + ')';

    // Every chat row: reveal (fade + tiny rise) once its `at` has passed.
    E.rows.forEach(function (row) {
      var cfg = row.cfg;

      if (cfg.type === 'typing') {
        var growIn = FILM.easeOut(FILM.progress(t, cfg.at, cfg.at + 220));
        var fadeOutStart = cfg.outAt - 420;
        var shrink = FILM.easeInOut(FILM.progress(t, fadeOutStart, cfg.outAt));
        var fullHeight = row.refs.naturalHeight || 46;
        var height = t < cfg.at ? 0 : FILM.lerp(0, fullHeight, t < fadeOutStart ? growIn : 1 - shrink);
        row.el.style.height = height + 'px';
        row.el.style.overflow = 'hidden';
        row.el.style.opacity = String(t < cfg.at ? 0 : (t < fadeOutStart ? growIn : 1 - shrink));
        row.el.style.marginBottom = height > 1 ? '12px' : '0px';
        // three dots pulse — motion computed from t, not a CSS animation
        row.refs.dots.forEach(function (dot, i) {
          var phase = (t - cfg.at) / 260 + i * 0.6;
          var pulse = 0.35 + 0.65 * Math.abs(Math.sin(phase));
          dot.style.opacity = String(t >= cfg.at && t < cfg.outAt ? pulse : 0);
        });
        return;
      }

      if (t < cfg.at) {
        row.el.style.opacity = '0';
        row.el.style.transform = 'translateY(6px)';
        return;
      }
      var reveal = FILM.easeOut(FILM.progress(t, cfg.at, cfg.at + 260));
      row.el.style.opacity = String(reveal);
      row.el.style.transform = 'translateY(' + FILM.lerp(6, 0, reveal) + 'px)';

      if (cfg.type === 'received' && cfg.tick) {
        var tickIn = FILM.progress(t, cfg.at + 180, cfg.at + 420);
        row.refs.tick.style.opacity = String(tickIn);
      }

      if (cfg.type === 'sent' && cfg.degrade) {
        var d = DEGRADE[cfg.degrade];
        row.refs.bubble.style.fontSize = d.fontSize;
        row.refs.bubble.style.color = d.color;
        row.refs.bubble.style.background = d.bg;
        row.refs.bubble.style.border = d.border;
      }
    });

    // Chat auto-scroll: bottom-anchored, like a real messaging app. The
    // newest revealed row's bottom edge is pinned to the bottom of the
    // visible body — when the conversation is short that pushes the whole
    // column down (empty space collects ABOVE it, not below), and once it
    // outgrows the body the same formula naturally becomes "scroll up to
    // keep the latest message in view". Pure measurement of already-laid-out
    // DOM, so it is stable under any seek order.
    var lastVisible = null;
    E.rows.forEach(function (row) {
      if (t >= row.cfg.at) lastVisible = row;
    });
    if (lastVisible) {
      var bottom = lastVisible.el.offsetTop + lastVisible.el.offsetHeight;
      var offset = E.body.clientHeight - bottom;
      E.scroll.style.transform = 'translateY(' + offset + 'px)';
    }

    // Counter HUD.
    var hudOpacity = FILM.progress(t, 1400, 1700);
    var crossfadeOut = 1 - FILM.progress(t, TALLY_AT, TALLY_DONE);
    var crossfadeIn = FILM.progress(t, TALLY_AT, TALLY_DONE);
    E.hud.style.opacity = String(hudOpacity);
    E.hudRunning.style.opacity = String(crossfadeOut);
    E.hudFinal.style.opacity = String(crossfadeIn);

    var collected = t >= PAID_AT ? 2400 : 0;
    E.hudValue.innerHTML = '₹' + collected.toLocaleString('en-IN') +
      ' <span class="minor">of ₹9,600</span>';

    E.hudOut.innerHTML = '₹7,200 <span class="minor" style="color:var(--ink-2);font-size:0.62em;">outstanding</span>';
    E.hudDays.innerHTML = '11 <span class="minor" style="color:var(--ink-2);font-size:0.62em;">days</span>';
    E.hudReminders.innerHTML = '4 <span class="minor" style="color:var(--ink-2);font-size:0.62em;">reminders</span>';
  }

  window.FILM.register({
    id: 's1-problem',
    startMs: START,
    endMs: END,
    mount: mount,
    draw: draw,
  });

  // Captions cover the scene edge to edge (SCRIPT.md: narration is on screen
  // as captions ALWAYS) rather than appearing only for the closing line —
  // four contiguous windows, 0 to END, each picking up exactly where the
  // last one stopped.
  window.FILM.caption('Ada books four bus tickets to Goa — ₹9,600, on one card.', 0, 3600);
  window.FILM.caption('She asks the other four for it back. One pays. Two stall. One goes quiet.', 3600, 9400);
  window.FILM.caption('Days pass. She keeps asking — smaller and smaller each time.', 9400, 20800);
  window.FILM.caption(
    'Somebody always pays first. Then they spend a fortnight asking for it back.',
    20800,
    END
  );
})();
