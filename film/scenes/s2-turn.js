// sutra — film · Scene 2 · THE TURN (0:28-0:40)
// --------------------------------------------------------------------------
// The chat desaturates and pulls back. One line, centred, then a beat, then
// the sutra mark and a second line. This is the whole film's thesis
// statement, so it stays plain: no new UI, just typography and the ghost of
// the chat we just watched turning into a problem.

(function () {
  var START = 28000;
  var END = 40000;
  var LOCAL_END = END - START;

  var PULLBACK_END = 2200;

  var LINE1_IN_FROM = 1800, LINE1_IN_TO = 2300;
  var LINE1_OUT_FROM = 5600, LINE1_OUT_TO = 6000;

  var MARK_IN_FROM = 6400, MARK_IN_TO = 6900;
  var LINE2_IN_FROM = 6900, LINE2_IN_TO = 7400;

  var CAPTION_SPLIT = 6400; // hands off from echoing line 1 to the closing line, at the mark's entrance

  function el(tag, className, parent) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (parent) parent.appendChild(e);
    return e;
  }

  // A small, static, generic echo of scene 1's phone — not a live clone of
  // its DOM (each scene owns and mounts its own subtree), just enough of
  // the same chrome and a couple of the same lines to read as "the same
  // chat" as it recedes behind the turn.
  function buildBackdropPhone(parent) {
    var phone = el('div', 'film-phone film-phone-sm', parent);
    el('div', 'film-phone-notch', phone);
    var screen = el('div', 'film-phone-screen', phone);
    var header = el('div', 'film-chat-header', screen);
    var avatar = el('div', 'film-chat-avatar', header);
    avatar.textContent = '✈️';
    el('div', 'film-chat-title', el('div', '', header)).textContent = 'goa trip ✈️';

    var body = el('div', 'film-chat-body', screen);
    var scroll = el('div', 'film-chat-scroll', body);
    scroll.style.padding = '18px 4px';

    var lines = [
      { text: 'booked! 2400 each 🙏', sent: true },
      { text: 'paying tonight!', sent: false },
      { text: 'guys?', sent: true, muted: true },
      { text: '₹7,200 outstanding · 11 days', sent: false, system: true },
    ];
    lines.forEach(function (line) {
      var row = el('div', 'film-row film-row-msg ' + (line.sent ? 'sent' : 'received'), scroll);
      var bubble = el(
        'div',
        'film-bubble ' + (line.system ? 'system' : line.sent ? (line.muted ? 'sent-muted' : 'sent-primary') : 'received'),
        row
      );
      bubble.textContent = line.text;
    });

    return phone;
  }

  function mount(root) {
    var backdrop = el('div', 'film-turn-backdrop', root);
    buildBackdropPhone(backdrop);

    var line1 = el('div', 'film-turn-line', root);
    line1.innerHTML = 'What if nobody had to <span class="brand">pay first</span>?';

    var mark = el('div', 'film-turn-mark', root);
    mark.style.top = '446px';
    mark.innerHTML = 'sutra<span class="dot">.</span>';

    var line2 = el('div', 'film-turn-line', root);
    line2.style.top = '588px';
    line2.style.fontSize = '42px';
    line2.style.fontWeight = '600';
    line2.innerHTML = '<span class="brand">Everyone approves. Everyone pays.</span><br>Same moment. Or nobody does.';

    root._els = { backdrop: backdrop, line1: line1, mark: mark, line2: line2 };
  }

  function draw(t, root) {
    var FILM = window.FILM;
    var E = root._els;

    var pull = FILM.easeInOut(FILM.progress(t, 0, PULLBACK_END));
    var scale = FILM.lerp(0.92, 0.5, pull);
    var y = FILM.lerp(0, -260, pull);
    var gray = FILM.lerp(0, 100, pull);
    var fade = FILM.lerp(1, 0.4, pull);
    E.backdrop.style.transform = 'translate(-50%, -50%) translateY(' + y + 'px) scale(' + scale + ')';
    E.backdrop.style.filter = 'grayscale(' + gray + '%)';
    E.backdrop.style.opacity = String(fade);

    var l1In = FILM.easeOut(FILM.progress(t, LINE1_IN_FROM, LINE1_IN_TO));
    var l1Out = FILM.progress(t, LINE1_OUT_FROM, LINE1_OUT_TO);
    var l1Op = Math.max(0, l1In - l1Out);
    E.line1.style.opacity = String(l1Op);
    E.line1.style.transform = 'translate(-50%, -50%) translateY(' + FILM.lerp(14, 0, l1In) + 'px)';

    var markIn = FILM.easeOut(FILM.progress(t, MARK_IN_FROM, MARK_IN_TO));
    E.mark.style.opacity = String(markIn);
    E.mark.style.transform = 'translateX(-50%) translateY(' + FILM.lerp(10, 0, markIn) + 'px)';

    var l2In = FILM.easeOut(FILM.progress(t, LINE2_IN_FROM, LINE2_IN_TO));
    E.line2.style.opacity = String(l2In);
    E.line2.style.transform = 'translate(-50%, 0) translateY(' + FILM.lerp(10, 0, l2In) + 'px)';
  }

  window.FILM.register({
    id: 's2-turn',
    startMs: START,
    endMs: END,
    mount: mount,
    draw: draw,
  });

  // Full coverage, 0 to END (SCRIPT.md: narration is on screen as captions
  // ALWAYS) — the caption band echoes the big centred line while it's up,
  // then hands off to the closing line the instant the mark arrives.
  window.FILM.caption('What if nobody had to pay first?', START, START + CAPTION_SPLIT);
  window.FILM.caption(
    'sutra is a payment protocol for more than one person.',
    START + CAPTION_SPLIT,
    END
  );
})();
