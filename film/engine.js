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

  // Each scene gets an editorially chosen delivery window. The previous
  // global speed-up made dense UI montages race and sparse closing cards drag.
  // Draw functions still receive their authored source time, preserving every
  // deterministic beat while the delivery clock stays exactly 1:55.
  var TIMING = [
    [0, 28000, 0, 12000],
    [28000, 40000, 12000, 19000],
    [40000, 65000, 19000, 34000],
    [65000, 82000, 34000, 49000],
    [82000, 102000, 49000, 64000],
    [102000, 120000, 64000, 75000],
    [120000, 145000, 75000, 96000],
    [145000, 165000, 96000, 104000],
    [165000, 190000, 104000, 115000]
  ];

  function timingForSource(t) {
    for (var i = 0; i < TIMING.length; i++) {
      if (t >= TIMING[i][0] && t <= TIMING[i][1]) return TIMING[i];
    }
    return TIMING[TIMING.length - 1];
  }

  function sourceToDelivery(t) {
    var w = timingForSource(t);
    return w[2] + ((t - w[0]) / (w[1] - w[0])) * (w[3] - w[2]);
  }

  var stage, scenesLayer, hairlineFill, captionLayer, captionText;
  var chapterLayer, chapterIndex, chapterName, transitionLayer, transitionEdge;
  var energyLayer, energyBeam, timecodeLayer;

  var CHAPTERS = {
    's1-problem': ['01', 'The old way'],
    's2-turn': ['02', 'The turn'],
    's3-solution': ['03', 'One group. Four cards.'],
    's4-surfaces': ['04', 'Start anywhere'],
    's5-planning': ['05', 'Plan before paying'],
    's6-thread': ['06', 'An agent with limits'],
    's7-nanda': ['07', 'Proof, not promises'],
    's8-limits': ['08', 'Where it stops'],
    's9-close': ['09', 'The receipt'],
  };

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

  // A small, deterministic illustrated cast. These are DOM shapes instead
  // of external stock art so the same four people can recur throughout the
  // film, react to the story, and remain perfectly frame-addressable.
  function character(parent, options) {
    options = options || {};
    var person = document.createElement('div');
    person.className = 'film-person film-person-' + (options.key || 'ada');
    person.style.setProperty('--shirt', options.shirt || '#ff5c35');
    person.style.setProperty('--skin', options.skin || '#9a5f3d');
    person.style.setProperty('--hair', options.hair || '#231a16');
    var shadow = document.createElement('div'); shadow.className = 'film-person-shadow'; person.appendChild(shadow);
    var torso = document.createElement('div'); torso.className = 'film-person-torso'; person.appendChild(torso);
    var armL = document.createElement('div'); armL.className = 'film-person-arm arm-l'; person.appendChild(armL);
    var armR = document.createElement('div'); armR.className = 'film-person-arm arm-r'; person.appendChild(armR);
    var neck = document.createElement('div'); neck.className = 'film-person-neck'; person.appendChild(neck);
    var head = document.createElement('div'); head.className = 'film-person-head'; person.appendChild(head);
    var ear = document.createElement('div'); ear.className = 'film-person-ear'; head.appendChild(ear);
    var hair = document.createElement('div'); hair.className = 'film-person-hair'; head.appendChild(hair);
    var brow = document.createElement('div'); brow.className = 'film-person-brow'; head.appendChild(brow);
    var eyes = document.createElement('div'); eyes.className = 'film-person-eyes'; head.appendChild(eyes);
    var mouth = document.createElement('div'); mouth.className = 'film-person-mouth'; head.appendChild(mouth);
    if (options.glasses) { var glasses = document.createElement('div'); glasses.className = 'film-person-glasses'; head.appendChild(glasses); }
    var label = document.createElement('div'); label.className = 'film-person-label'; label.textContent = options.name || ''; person.appendChild(label);
    if (parent) parent.appendChild(person);
    return person;
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
    scene._sourceStartMs = scene.startMs;
    scene._sourceEndMs = scene.endMs;
    scene.startMs = sourceToDelivery(scene.startMs);
    scene.endMs = sourceToDelivery(scene.endMs);
    scenes.push(scene);
    scenes.sort(function (a, b) { return a.startMs - b.startMs; });
  }

  // fromMs/toMs are ABSOLUTE film time, so a caption can span or sit
  // anywhere regardless of which scene owns that moment.
  function caption(text, fromMs, toMs) {
    captionList.push({ text: text, fromMs: sourceToDelivery(fromMs), toMs: sourceToDelivery(toMs) });
  }

  // -- chrome (built once, lazily, on first seek) -----------------------------

  function buildChrome() {
    stage = document.getElementById('film-stage');
    if (!stage) {
      stage = document.createElement('div');
      stage.id = 'film-stage';
      document.body.appendChild(stage);
    }

    var atmosphere = document.createElement('div');
    atmosphere.id = 'film-atmosphere';
    stage.appendChild(atmosphere);

    scenesLayer = document.createElement('div');
    scenesLayer.id = 'film-scenes';
    stage.appendChild(scenesLayer);

    var hairline = document.createElement('div');
    hairline.id = 'film-hairline';
    hairlineFill = document.createElement('div');
    hairlineFill.id = 'film-hairline-fill';
    hairline.appendChild(hairlineFill);
    stage.appendChild(hairline);

    chapterLayer = document.createElement('div');
    chapterLayer.id = 'film-chapter';
    chapterIndex = document.createElement('span');
    chapterIndex.id = 'film-chapter-index';
    chapterName = document.createElement('span');
    chapterName.id = 'film-chapter-name';
    chapterLayer.appendChild(chapterIndex);
    chapterLayer.appendChild(chapterName);
    stage.appendChild(chapterLayer);

    captionLayer = document.createElement('div');
    captionLayer.id = 'film-caption';
    captionText = document.createElement('p');
    captionText.id = 'film-caption-text';
    captionLayer.appendChild(captionText);
    stage.appendChild(captionLayer);

    transitionLayer = document.createElement('div');
    transitionLayer.id = 'film-transition';
    transitionEdge = document.createElement('div');
    transitionEdge.id = 'film-transition-edge';
    transitionLayer.appendChild(transitionEdge);
    stage.appendChild(transitionLayer);

    energyLayer = document.createElement('div');
    energyLayer.id = 'film-energy';
    energyBeam = document.createElement('div');
    energyBeam.id = 'film-energy-beam';
    energyLayer.appendChild(energyBeam);
    stage.appendChild(energyLayer);

    timecodeLayer = document.createElement('div');
    timecodeLayer.id = 'film-timecode';
    stage.appendChild(timecodeLayer);
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
      var outputLocalT = clamp(t - active.startMs, 0, active.endMs - active.startMs);
      var outputSceneDuration = active.endMs - active.startMs;
      var sceneDuration = (active._sourceEndMs - active._sourceStartMs);
      var localT = outputSceneDuration > 0 ? (outputLocalT / outputSceneDuration) * sceneDuration : 0;
      var intro = easeOut(progress(localT, 0, active === scenes[0] ? 1 : 620));
      var outro = easeIn(progress(localT, sceneDuration - 420, sceneDuration));
      var drift = easeInOut(progress(localT, 0, sceneDuration));
      var direction = scenes.indexOf(active) % 2 === 0 ? 1 : -1;

      // A restrained virtual camera: fast push on entry, slow parallax drift,
      // and a tiny counter-rotation. It makes the UI feel photographed rather
      // than screen-captured while preserving pause-frame legibility.
      var punch = 1 - easeOut(progress(outputLocalT, 0, 520));
      var cameraScale = lerp(1.018, 1.006, drift) + punch * 0.012;
      var cameraRotate = 0;

      active._container.style.opacity = String(intro * (1 - outro * 0.35));
      active._container.style.transform =
        'translate3d(' + lerp(direction * 10, direction * -6, drift) + 'px,' +
        lerp(5, -3, drift) + 'px,0) rotate(' + cameraRotate + 'deg) scale(' + cameraScale + ')';

      var chapter = CHAPTERS[active.id] || ['', ''];
      var lightScene = active.id !== 's1-problem';
      chapterIndex.textContent = chapter[0];
      chapterName.textContent = chapter[1];
      chapterIndex.style.color = lightScene ? '#c63817' : '#ff8b6f';
      chapterIndex.style.borderColor = lightScene ? '#ffc4b5' : 'rgb(255 139 111 / .4)';
      chapterIndex.style.background = lightScene ? '#fff0ea' : 'rgb(255 92 53 / .1)';
      chapterName.style.color = lightScene ? '#5d5b55' : 'rgb(255 255 255 / .6)';
      timecodeLayer.style.color = lightScene ? '#89867e' : 'rgb(255 255 255 / .35)';
      chapterLayer.style.opacity = String(easeOut(progress(localT, 520, 980)) * (1 - outro));

      var cover = Math.max(1 - intro, outro);
      transitionLayer.style.clipPath = 'inset(0 ' + (100 - cover * 100) + '% 0 0)';
      transitionLayer.style.opacity = cover > 0.002 ? '1' : '0';
      transitionEdge.style.left = (cover * 100) + '%';

      var beat = Math.max(
        1 - easeOut(progress(outputLocalT, 0, 360)),
        easeIn(progress(outputLocalT, outputSceneDuration - 240, outputSceneDuration))
      );
      energyLayer.style.opacity = '0';
      energyLayer.style.transform = 'translateX(' + lerp(-46, 46, drift) + '%) skewX(-12deg)';
      energyBeam.style.transform = 'scaleX(' + (0.35 + beat * 1.3) + ')';
      timecodeLayer.textContent = String(Math.floor(t / 1000)).padStart(2, '0') + ' / 115';
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
    character: character,

    sourceToDelivery: sourceToDelivery,

    currentMs: 0,
  };

  Object.defineProperty(FILM, 'durationMs', {
    get: getDuration,
    enumerable: true,
  });

  window.FILM = FILM;
})();
