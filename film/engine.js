// sutra — film engine
// --------------------------------------------------------------------------
// The shared spine every scene is built on. THE RULE: there is no real-time
// animation and no CSS keyframe animation anywhere in this film. The
// renderer (film/render.mjs) screenshots the page by calling
// window.FILM.seek(t) at a series of timestamps, cold, in any order it
// likes. seek(t) must synchronously paint the exact state for time t with
// no transitions, so that seek(5000) called first thing produces a
// pixel-identical result to seek(0) then seek(5000).
//
// That determinism comes from one discipline, kept everywhere in this file
// and expected of every scene: mount(root) builds static DOM once and never
// depends on t; draw(localT, root) is a pure function of localT that sets
// every property it cares about on every call — it never reads the current
// state and nudges it, only ever computes the absolute value for localT and
// writes it.
//
//   FILM.register({ id, startMs, endMs, mount(root), draw(localT, root) })
//   FILM.caption(text, fromMs, toMs)   -- absolute film time, fixed lower band
//   FILM.seek(t)                        -- paint the exact frame for time t
//   FILM.durationMs                     -- max endMs across every registered scene
//
// Both agents building this film share this one file. Scene files register
// themselves by calling FILM.register(...) at load time (script order does
// not matter — scenes are sorted by startMs); nothing else here should need
// to change as scenes 4-9 are added.

(function () {
  'use strict';

  var scenes = [];
  var captionList = [];
  var initialized = false;

  var stage, scenesLayer, hairlineFill, captionLayer, captionText;

  // -- numeric helpers, all pure functions of their arguments --------------

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function lerp(a, b, t) {
    return a + (b - a) * clamp(t, 0, 1);
  }

  // 0..1 progress of `t` between `from` and `to`. Handles from===to safely.
  function progress(t, from, to) {
    if (to <= from) return t >= to ? 1 : 0;
    return clamp((t - from) / (to - from), 0, 1);
  }

  function easeIn(t) {
    t = clamp(t, 0, 1);
    return t * t * t;
  }

  function easeOut(t) {
    t = clamp(t, 0, 1);
    return 1 - Math.pow(1 - t, 3);
  }

  function easeInOut(t) {
    t = clamp(t, 0, 1);
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  // Characters revealed by localT at `cps` characters per second. Pure
  // function of localT — never mutate a counter, always recompute from t.
  function typewriter(text, localT, cps) {
    if (localT <= 0) return '';
    var n = Math.floor((localT / 1000) * (cps || 18));
    if (n >= text.length) return text;
    return text.slice(0, Math.max(0, n));
  }

  // -- registry --------------------------------------------------------------

  function register(scene) {
    if (!scene || typeof scene.id !== 'string') {
      throw new Error('FILM.register: scene.id (string) is required');
    }
    if (typeof scene.startMs !== 'number' || typeof scene.endMs !== 'number') {
      throw new Error('FILM.register: scene "' + scene.id + '" needs numeric startMs/endMs');
    }
    if (typeof scene.draw !== 'function') {
      throw new Error('FILM.register: scene "' + scene.id + '" needs a draw(localT, root) function');
    }
    scenes.push(scene);
    scenes.sort(function (a, b) { return a.startMs - b.startMs; });
  }

  // fromMs/toMs are ABSOLUTE film time, so a caption can span or sit
  // anywhere regardless of which scene owns that moment.
  function caption(text, fromMs, toMs) {
    captionList.push({ text: text, fromMs: fromMs, toMs: toMs });
  }

  // -- chrome (built once, lazily, on first seek) -----------------------------

  function buildChrome() {
    stage = document.getElementById('film-stage');
    if (!stage) {
      stage = document.createElement('div');
      stage.id = 'film-stage';
      document.body.appendChild(stage);
    }

    scenesLayer = document.createElement('div');
    scenesLayer.id = 'film-scenes';
    stage.appendChild(scenesLayer);

    var hairline = document.createElement('div');
    hairline.id = 'film-hairline';
    hairlineFill = document.createElement('div');
    hairlineFill.id = 'film-hairline-fill';
    hairline.appendChild(hairlineFill);
    stage.appendChild(hairline);

    captionLayer = document.createElement('div');
    captionLayer.id = 'film-caption';
    captionText = document.createElement('p');
    captionText.id = 'film-caption-text';
    captionLayer.appendChild(captionText);
    stage.appendChild(captionLayer);
  }

  function ensureInit() {
    if (initialized) return;
    initialized = true;
    buildChrome();
    // Mount every registered scene exactly once, regardless of which t is
    // sought first. This is what makes cold seeks and sequential seeks
    // agree: by the time any draw() runs, every scene's static DOM already
    // exists, identically, every time.
    scenes.forEach(function (s) {
      var container = document.createElement('div');
      container.className = 'film-scene';
      container.id = 'film-scene-' + s.id;
      container.style.display = 'none';
      scenesLayer.appendChild(container);
      s._container = container;
      if (typeof s.mount === 'function') s.mount(container);
    });
  }

  function getDuration() {
    if (!scenes.length) return 0;
    var max = 0;
    for (var i = 0; i < scenes.length; i++) {
      if (scenes[i].endMs > max) max = scenes[i].endMs;
    }
    return max;
  }

  function findActiveScene(t) {
    for (var i = 0; i < scenes.length; i++) {
      var s = scenes[i];
      if (t >= s.startMs && t < s.endMs) return s;
    }
    // t sits exactly on the final frame, or in a gap between scenes: fall
    // back to the latest scene that has already started.
    for (var j = scenes.length - 1; j >= 0; j--) {
      if (t >= scenes[j].startMs) return scenes[j];
    }
    return scenes.length ? scenes[0] : null;
  }

  function renderCaption(t) {
    if (!captionText) return;
    var active = null;
    for (var i = 0; i < captionList.length; i++) {
      var c = captionList[i];
      if (t >= c.fromMs && t < c.toMs) active = c; // last match wins if authors overlap
    }
    if (!active) {
      captionText.textContent = '';
      captionLayer.style.opacity = '0';
      return;
    }
    var span = active.toMs - active.fromMs;
    var fadeMs = Math.min(260, span / 2);
    var op = 1;
    if (t < active.fromMs + fadeMs) op = (t - active.fromMs) / fadeMs;
    else if (t > active.toMs - fadeMs) op = (active.toMs - t) / fadeMs;
    captionText.textContent = active.text;
    captionLayer.style.opacity = String(clamp(op, 0, 1));
  }

  // -- the one entry point the renderer calls ---------------------------------

  function seek(t) {
    ensureInit();
    var duration = getDuration();
    t = clamp(t, 0, duration);

    if (hairlineFill) {
      hairlineFill.style.width = (duration > 0 ? (t / duration) * 100 : 0) + '%';
    }

    var active = findActiveScene(t);
    scenes.forEach(function (s) {
      s._container.style.display = (s === active) ? 'block' : 'none';
    });

    if (active) {
      var localT = clamp(t - active.startMs, 0, active.endMs - active.startMs);
      active.draw(localT, active._container);
    }

    renderCaption(t);

    FILM.currentMs = t;
    return t;
  }

  var FILM = {
    register: register,
    caption: caption,
    seek: seek,

    clamp: clamp,
    lerp: lerp,
    progress: progress,
    easeIn: easeIn,
    easeOut: easeOut,
    easeInOut: easeInOut,
    typewriter: typewriter,

    currentMs: 0,
  };

  Object.defineProperty(FILM, 'durationMs', {
    get: getDuration,
    enumerable: true,
  });

  window.FILM = FILM;
})();
