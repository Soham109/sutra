// sutra — film · Scene 3 · THE SAME TRIP, DONE PROPERLY (0:40-1:05)
// --------------------------------------------------------------------------
// Four phones, side by side, running the same ₹9,600 Goa trip as scene 1 —
// this time nobody fronts anything. Approving never charges a card; only
// the last approval, landing, charges all four in the same frame. The held
// beat ("Nothing has been charged yet") is the scene's whole point and it
// sits for well over two seconds before the fourth approval resolves it.

(function () {
  var START = 40000;
  var END = 65000;

  var MERCHANT = 'Konkan Coach Lines';
  var TOTAL = '₹9,600';
  var SHARE = 2400;
  var SHARE_STR = '₹2,400';

  // Every person's own timeline, in localT. Ada is the organiser: her
  // approval is folded into "send" rather than a separate dramatic tap.
  var PEOPLE = [
    { key: 'ada', name: 'Ada', organizer: true, lightAt: 0, ringFrom: 1700, ringTo: 2300 },
    { key: 'arsh', name: 'Arsh', lightAt: 1300, ringFrom: 4200, ringTo: 4700 },
    { key: 'maya', name: 'Maya', lightAt: 1800, ringFrom: 7600, ringTo: 8100 },
    { key: 'dev', name: 'Dev', lightAt: 2300, ringFrom: 8600, ringTo: 9100 },
  ];
  var CHORD_AT = 9100; // Dev's approval lands last; all four settle in this one frame

  var SEND_TAP_FROM = 900, SEND_TAP_TO = 1500;

  // Captions cover the scene almost edge to edge (SCRIPT.md: narration is on
  // screen as captions ALWAYS) — but the hold's start/end and the chord's
  // timestamp are exactly what the coordinator asked to leave untouched.
  var HOLD_CAPTION_FROM = 4700, HOLD_CAPTION_TO = 7200; // the 2.5s beat that matters — unchanged
  var FINAL_CAPTION_FROM = 9600, FINAL_CAPTION_TO = 25000; // was 16000; now holds to the scene's end

  // Ring geometry: an SVG rounded-rect that hugs each phone's own outline.
  var RING_W = 298, RING_H = 624, RING_RX = 46, RING_STROKE = 6;
  var RING_PERIMETER = 2 * (RING_W + RING_H) - 8 * RING_RX + 2 * Math.PI * RING_RX;

  function el(tag, className, parent) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (parent) parent.appendChild(e);
    return e;
  }

  function svgEl(tag, attrs, parent) {
    var e = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function buildSlot(parent, person) {
    var slot = el('div', 'film-settle-slot', parent);

    var svg = svgEl('svg', { class: 'film-settle-ring', viewBox: '0 0 316 642' }, slot);
    svgEl('rect', {
      class: 'track', x: 9, y: 9, width: RING_W, height: RING_H, rx: RING_RX, 'stroke-width': RING_STROKE,
    }, svg);
    var fillRect = svgEl('rect', {
      class: 'fill', x: 9, y: 9, width: RING_W, height: RING_H, rx: RING_RX, 'stroke-width': RING_STROKE,
      'stroke-dasharray': RING_PERIMETER, 'stroke-dashoffset': RING_PERIMETER,
    }, svg);

    var phone = el('div', 'film-phone film-phone-sm film-settle-phone', slot);
    el('div', 'film-phone-notch', phone);
    var screen = el('div', 'film-phone-screen', phone);
    var status = el('div', 'film-phone-status', screen);
    status.innerHTML = '<span>9:41</span><span>📶 🔋</span>';

    var stack = el('div', '', screen);
    stack.style.cssText = 'position:relative;flex:1;';

    var panels = {};

    if (person.organizer) {
      var compose = el('div', 'film-panel film-panel-compose', stack);
      var top = el('div', '', compose);
      el('div', 'eyebrow', top).textContent = 'goa bus';
      var title = el('div', 'film-compose-title', top);
      title.textContent = TOTAL + ' · 4 people';
      var sub = el('div', 'film-compose-sub', top);
      sub.textContent = MERCHANT;
      var note = el('div', 'film-compose-note', compose);
      note.textContent = 'Each of the 4 gets their own link, for their own ' + SHARE_STR + '. Nobody pays until everybody has.';
      var sendBtn = el('div', 'film-send-btn', compose);
      sendBtn.textContent = 'Send everyone their link';
      panels.compose = compose;
      panels.sendBtn = sendBtn;
    } else {
      var locked = el('div', 'film-panel film-panel-locked', stack);
      el('div', 'glyph', locked).textContent = '🔒';
      var msg = el('div', 'msg', locked);
      msg.textContent = 'Waiting for Ada';
      panels.locked = locked;
    }

    var approve = el('div', 'film-panel film-panel-approve', stack);
    el('div', 'eyebrow', approve).textContent = 'your share';
    var shareRow = el('div', 'film-approve-share', approve);
    var shareAmt = el('div', 'amount', shareRow);
    shareAmt.textContent = SHARE_STR;
    var merchantChip = el('div', 'film-approve-merchant', approve);
    merchantChip.textContent = MERCHANT;
    var cap = el('div', 'film-approve-cap', approve);
    cap.textContent = 'capped at ' + SHARE_STR;

    // Real, live group state — fills the space between the cap note and the
    // button with the fact that actually matters: how many of the four are
    // in so far. Every phone shows the same shared count.
    var progress = el('div', 'film-approve-progress', approve);
    var progressLabel = el('span', '', progress);
    var progressTrack = el('span', 'track', progress);
    var progressFill = el('b', '', progressTrack);
    panels.progressLabel = progressLabel;
    panels.progressFill = progressFill;

    var approveBtn = el('div', 'film-approve-btn', approve);
    approveBtn.innerHTML = '🔑 Approve with passkey';
    var approvedBadge = el('div', 'film-approve-badge', approve);
    approvedBadge.textContent = 'Approved · waiting for others';
    approvedBadge.style.display = 'none';
    panels.approve = approve;
    panels.approveBtn = approveBtn;
    panels.approvedBadge = approvedBadge;

    var paid = el('div', 'film-panel film-panel-paid', stack);
    var check = el('div', 'check', paid);
    check.textContent = '✓';
    var paidAmount = el('div', 'paid-amount amount', paid);
    paidAmount.textContent = SHARE_STR;
    var paidLabel = el('div', 'paid-label', paid);
    paidLabel.textContent = 'Paid';
    panels.paid = paid;

    var nameLabel = el('div', 'film-settle-name', slot);
    nameLabel.textContent = person.name;

    return { slot: slot, fillRect: fillRect, panels: panels, nameLabel: nameLabel };
  }

  function mount(root) {
    var rail = el('div', 's3-protocol-rail', root);
    var railTrack = el('div', 's3-rail-track', rail);
    var railFill = el('div', 's3-rail-fill', railTrack);
    var railNodes = PEOPLE.map(function (person, i) {
      var node = el('div', 's3-rail-node', rail);
      node.style.left = (12.5 + i * 25) + '%';
      var core = el('i', '', node);
      el('small', '', node).textContent = 'OWN CARD';
      return { el: node, core: core };
    });
    var railState = el('div', 's3-rail-state', rail);
    railState.textContent = '0 / 4 mandates';
    var cast = el('div', 's3-cast', root);
    var looks = {
      ada:  { shirt: '#ff5c35', skin: '#9b6042', hair: '#241814', glasses: true },
      arsh: { shirt: '#d9a516', skin: '#855035', hair: '#17120f' },
      maya: { shirt: '#1687a4', skin: '#b36f4c', hair: '#241611' },
      dev:  { shirt: '#b72b2b', skin: '#7e472e', hair: '#17120f', glasses: true },
    };
    var castPeople = PEOPLE.map(function (person) {
      var look = looks[person.key];
      look.key = person.key; look.name = person.name;
      var wrap = el('div', 's3-cast-person', cast);
      var halo = el('div', 's3-halo', wrap);
      var figure = window.FILM.character(wrap, look);
      return { person: person, wrap: wrap, halo: halo, figure: figure };
    });
    var row = el('div', 'film-settle-row', root);
    var slots = PEOPLE.map(function (person) {
      return { person: person, refs: buildSlot(row, person) };
    });

    var flash = el('div', 'film-chord-flash', root);

    root._els = { row: row, slots: slots, flash: flash, cast: cast, castPeople: castPeople, rail: rail, railFill: railFill, railNodes: railNodes, railState: railState };
  }

  function draw(t, root) {
    var FILM = window.FILM;
    var E = root._els;

    var enter = FILM.easeOut(FILM.progress(t, 0, 900));
    E.row.style.opacity = String(enter);
    E.row.style.transform = 'translate(-50%, -50%) translateY(' + FILM.lerp(30, 0, enter) + 'px)';
    E.cast.style.opacity = String(enter);

    E.castPeople.forEach(function (c, i) {
      var approved = t >= c.person.ringTo;
      var pop = FILM.easeOut(FILM.progress(t, c.person.ringTo, c.person.ringTo + 420));
      var waitingBob = approved ? 0 : Math.sin((t + i * 260) / 850) * 3;
      c.figure.style.transform = 'translateY(' + (waitingBob - pop * 7) + 'px) scale(' + (1 + pop * .035) + ')';
      c.halo.style.opacity = String(pop);
      c.halo.style.transform = 'translate(-50%,-50%) scale(' + FILM.lerp(.55, 1, pop) + ')';
      c.figure.querySelector('.film-person-mouth').style.borderBottom = approved ? '3px solid rgb(73 35 27 / .72)' : '0';
      c.figure.querySelector('.film-person-mouth').style.borderTop = approved ? '0' : '3px solid rgb(73 35 27 / .72)';
    });

    var approvedCount = PEOPLE.filter(function (p) { return t >= p.ringTo; }).length;
    E.rail.style.opacity = String(FILM.easeOut(FILM.progress(t, 500, 1100)));
    E.railFill.style.width = (approvedCount / 4 * 100) + '%';
    E.railFill.style.background = t >= CHORD_AT ? 'var(--ok)' : 'var(--brand)';
    E.railState.textContent = t >= CHORD_AT ? 'COMMITTED · 4 cards in one moment' : approvedCount + ' / 4 mandates';
    E.railState.className = 's3-rail-state' + (t >= CHORD_AT ? ' committed' : '');
    E.railNodes.forEach(function (node, i) {
      var on = t >= PEOPLE[i].ringTo;
      node.el.className = 's3-rail-node' + (on ? ' on' : '');
      var pulse = on ? .8 + Math.sin((t + i * 210) / 180) * .2 : .25;
      node.core.style.boxShadow = on ? '0 0 ' + (18 + pulse * 18) + 'px rgb(255 92 53 / .8)' : 'none';
    });

    E.slots.forEach(function (s, i) {
      var person = s.person;
      var refs = s.refs;
      var lit = t >= person.lightAt;
      var ringProgress = FILM.easeOut(FILM.progress(t, person.ringFrom, person.ringTo));
      var approved = t >= person.ringTo;
      var paidNow = t >= CHORD_AT;

      // slight per-slot stagger so all four don't move in perfect lockstep
      var slotIn = FILM.easeOut(FILM.progress(t, i * 90, i * 90 + 500));
      refs.slot.style.opacity = String(Math.max(enter, slotIn));

      // ring fill
      var dashoffset = paidNow ? 0 : RING_PERIMETER * (1 - ringProgress);
      refs.fillRect.setAttribute('stroke-dashoffset', String(dashoffset));
      refs.fillRect.classList.toggle('paid', paidNow);

      if (person.organizer) {
        var composeOut = FILM.progress(t, SEND_TAP_FROM, SEND_TAP_TO);
        refs.panels.compose.style.opacity = String(1 - composeOut);
        refs.panels.compose.style.display = composeOut >= 1 ? 'none' : 'flex';
        var pressPulse = 1 - 0.05 * Math.max(0, 1 - FILM.progress(t, SEND_TAP_FROM, SEND_TAP_FROM + 200));
        refs.panels.sendBtn.style.transform = t >= SEND_TAP_FROM && t < SEND_TAP_TO ? 'scale(' + pressPulse + ')' : 'scale(1)';
      } else {
        refs.panels.locked.style.display = lit ? 'none' : 'flex';
        refs.panels.locked.style.opacity = lit ? '0' : '1';
      }

      // The approval card fades in right as the phone "lights up" (or, for
      // Ada, right as the compose screen has finished handing off) rather
      // than cutting in hard — the soft tick the script asks for.
      var revealAt = person.organizer ? SEND_TAP_TO : person.lightAt;
      var approveIn = FILM.easeOut(FILM.progress(t, revealAt, revealAt + 260));
      refs.panels.approve.style.opacity = paidNow ? '0' : String(approveIn);
      refs.panels.approve.style.display = (t >= revealAt && !paidNow) ? 'flex' : 'none';

      refs.panels.progressLabel.textContent = approvedCount + ' of 4 approved';
      refs.panels.progressFill.style.width = (approvedCount / 4 * 100) + '%';

      refs.panels.approveBtn.style.display = approved ? 'none' : 'flex';
      refs.panels.approvedBadge.style.display = approved ? 'flex' : 'none';
      if (!approved && ringProgress > 0) {
        refs.panels.approveBtn.style.transform = 'scale(' + (1 - 0.04 * Math.sin(ringProgress * Math.PI)) + ')';
      } else {
        refs.panels.approveBtn.style.transform = 'scale(1)';
      }

      var paidIn = FILM.easeOut(FILM.progress(t, CHORD_AT, CHORD_AT + 300));
      refs.panels.paid.style.opacity = String(paidNow ? paidIn : 0);
      refs.panels.paid.style.display = paidNow ? 'flex' : 'none';
    });

    // the chord: one shared flash across all four phones the instant the
    // last approval lands
    var flashT = t - CHORD_AT;
    var flashOp = 0;
    if (flashT >= 0 && flashT <= 500) {
      var fp = flashT / 500;
      flashOp = fp < 0.3 ? fp / 0.3 : (1 - fp) / 0.7;
    }
    E.flash.style.opacity = String(flashOp * 0.9);
  }

  window.FILM.register({
    id: 's3-solution',
    startMs: START,
    endMs: END,
    mount: mount,
    draw: draw,
  });

  window.FILM.caption('The same trip, done properly. Each person gets their own link.', START, START + HOLD_CAPTION_FROM);
  window.FILM.caption('Nothing has been charged yet.', START + HOLD_CAPTION_FROM, START + HOLD_CAPTION_TO);
  window.FILM.caption(
    'Each approves with their own passkey, their own card — capped at their own number.',
    START + HOLD_CAPTION_TO,
    START + FINAL_CAPTION_FROM
  );
  window.FILM.caption(
    'Four people. Four cards. One moment. Nobody fronted anything.',
    START + FINAL_CAPTION_FROM,
    START + FINAL_CAPTION_TO
  );
})();
