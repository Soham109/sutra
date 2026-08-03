// Shared timing math for the film's narration clock. Used by TWO callers
// that must never drift apart:
//
//   gen-timing-default.mjs   -- word-count ESTIMATES, no audio needed, output
//                                is committed as film/timing.js so the film
//                                previews/scrubs correctly before any voice
//                                has been generated.
//   build-narration-neural.mjs -- REAL ffprobe-measured durations + real
//                                word-boundary metadata from the TTS engine,
//                                output is film/build/timing.generated.js
//                                (gitignored build output) which OVERRIDES
//                                the default once real audio exists.
//
// Both produce the exact same shape (see buildTimingObject), so every scene
// can be written once against `window.FILM_TIMING` and stay correct whether
// or not audio has been built yet. This is what makes the pipeline
// self-correcting instead of relying on guessed timings baked into scene
// code: nobody hand-edits a millisecond number anywhere else in the film.

export const GAP_MS = 260
export const BEAT_ORDER = ['cold', 'mechanism', 'receipt', 'tour', 'planning', 'billthread', 'nanda', 'close']

// Estimated words-per-minute for the DEFAULT (pre-audio) timing. Chosen to
// match the real voice's calibrated pace (en-US-ChristopherNeural, rate
// +18%, measured ~150-155wpm) so the default and the real cut land close to
// the same total length and no scene has to be re-timed by hand later.
export const ESTIMATE_WPM = 155

// Minimum visual runtime each beat needs regardless of how fast the words
// land, so a brisk narration read never compresses a choreographed beat
// (the mechanism cart-split / sequential-charge sequence, especially).
export const MIN_BEAT_MS = {
  cold: 6500,
  mechanism: 15000,
  receipt: 10000,
  tour: 8000,
  planning: 8000,
  billthread: 8000,
  nanda: 12000,
  close: 8000,
}

// Extra silent hold appended after the CLOSE beat's last spoken word, so the
// wordless "receipt frame -> tagline -> links" sequence has room to land
// before the film ends.
export const CLOSE_TAIL_MS = 2600

/**
 * Split `text` into words and distribute `durationMs` across them by
 * character-length weight. This is only ever a rough approximation used for
 * the pre-audio default; real audio replaces it with actual word-boundary
 * timestamps from the TTS engine.
 */
export function estimateWords(text, durationMs) {
  const words = text.split(/\s+/).filter(Boolean)
  const weights = words.map((w) => w.replace(/[^\w]/g, '').length + 1)
  const total = weights.reduce((a, b) => a + b, 0) || 1
  let cursor = 0
  return words.map((w, i) => {
    const dur = (weights[i] / total) * durationMs
    const atMs = cursor
    cursor += dur
    return { text: w, atMs: Math.round(atMs), durationMs: Math.round(dur) }
  })
}

export function estimateDurationMs(text, wpm = ESTIMATE_WPM) {
  const words = text.split(/\s+/).filter(Boolean).length
  return Math.round((words / wpm) * 60000)
}

/**
 * Place lines on the timeline in order, pushing a line later than its
 * target `atMs` if the previous line (by real/estimated duration) is still
 * "speaking". Mirrors the exact cursor logic the original SAPI pipeline
 * used, generalised to work identically for estimates and real clips.
 *
 * `lines`: [{ beat, atMs, text, durationMs, words? }]  (durationMs required)
 * returns: same lines with `atMs` rewritten to the real placed position, and
 *          a `pushedMs` field recording how far (if at all) it moved.
 */
export function placeLines(lines, gapMs = GAP_MS) {
  let cursor = 0
  return lines.map((line) => {
    const startAt = Math.max(line.atMs, cursor)
    const pushedMs = startAt - line.atMs
    cursor = startAt + line.durationMs + gapMs
    return { ...line, atMs: startAt, pushedMs }
  })
}

/**
 * Derive contiguous, NON-OVERLAPPING beat windows from placed lines.
 *
 * Two passes, deliberately mirroring placeLines' own cursor logic one level
 * up: first cascade forward to find each beat's earliest feasible start and
 * end (its own narration's raw span, floored by MIN_BEAT_MS, and never
 * before the previous beat's end) — this is the same kind of push-later
 * correction placeLines applies to individual lines, applied to beats. Only
 * once every beat's feasible end is known does the second pass set each
 * beat's DISPLAYED end to the next beat's start, so a beat whose minimum
 * runtime forced it later never ends up claiming a time range that a later
 * beat also claims (the bug an end computed as `max(nextStart, minEnd)`
 * would have: if minEnd alone pushed past nextStart, both beats would think
 * they owned that stretch, and findActiveScene(t) would have to guess).
 */
export function deriveBeats(placedLines, beatOrder = BEAT_ORDER, minBeatMs = MIN_BEAT_MS, closeTailMs = CLOSE_TAIL_MS) {
  const raw = {}
  for (const beat of beatOrder) {
    const linesInBeat = placedLines.filter((l) => l.beat === beat)
    if (linesInBeat.length === 0) continue
    raw[beat] = {
      startMs: Math.min(...linesInBeat.map((l) => l.atMs)),
      rawEndMs: Math.max(...linesInBeat.map((l) => l.atMs + l.durationMs)),
    }
  }

  // Pass 1: cascade forward so no beat's feasible end overruns the next
  // beat's own narration start.
  let cursor = 0
  const feasible = {}
  for (const beat of beatOrder) {
    if (!raw[beat]) continue
    const startMs = Math.max(raw[beat].startMs, cursor)
    const minEnd = startMs + (minBeatMs[beat] || 0)
    const endMs = Math.max(raw[beat].rawEndMs, minEnd)
    feasible[beat] = { startMs, endMs }
    cursor = endMs
  }

  // Pass 2: each beat's DISPLAYED end is the next beat's (feasible) start,
  // so the film has no gaps and no overlaps; the last beat gets a trailing
  // silent hold instead of a next-beat boundary.
  const beats = {}
  const order = beatOrder.filter((b) => feasible[b])
  for (let i = 0; i < order.length; i++) {
    const beat = order[i]
    const next = order[i + 1]
    beats[beat] = {
      startMs: feasible[beat].startMs,
      endMs: next ? feasible[next].startMs : feasible[beat].endMs + closeTailMs,
    }
  }
  return beats
}

export function buildTimingObject(placedLines, beats, fps = 30) {
  const durationMs = Math.max(...Object.values(beats).map((b) => b.endMs))
  return { fps, generatedAt: new Date().toISOString(), beats, lines: placedLines, durationMs }
}

export function renderTimingJs(timingObj, varName = 'FILM_TIMING') {
  return `// AUTO-GENERATED. Do not hand-edit — see film/timing-lib.mjs.\n` +
    `window.${varName} = ${JSON.stringify(timingObj, null, 2)};\n`
}
