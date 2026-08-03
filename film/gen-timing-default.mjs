// Generates film/timing.js — the DEFAULT, pre-audio timing estimate, built
// purely from word counts in narration.json (no TTS, no network, no
// ffprobe). This is what makes `npm run film:preview` useful before a
// single voice clip has been generated: every scene, caption and cue reads
// timing from `window.FILM_TIMING`, and this file is a committed, always-
// present source of it.
//
// Re-run this whenever narration.json's line text changes:
//   node film/gen-timing-default.mjs
//
// It is superseded at build time by film/build/timing.generated.js, written
// by build-narration-neural.mjs from REAL measured audio — see timing-lib.mjs
// for how the two stay consistent.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { estimateWords, estimateDurationMs, placeLines, deriveBeats, buildTimingObject, renderTimingJs } from './timing-lib.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const spec = JSON.parse(readFileSync(join(here, 'narration.json'), 'utf8'))

const withEstimates = spec.lines.map((line) => {
  const durationMs = estimateDurationMs(line.text)
  return { ...line, durationMs, words: estimateWords(line.text, durationMs) }
})

const placed = placeLines(withEstimates, spec.gapMs ?? 260)
const beats = deriveBeats(placed)
const timing = buildTimingObject(placed, beats)

writeFileSync(join(here, 'timing.js'), renderTimingJs(timing))

console.log(`film/timing.js written (estimate, ${(timing.durationMs / 1000).toFixed(1)}s total)`)
for (const [beat, w] of Object.entries(timing.beats)) {
  console.log(`  ${beat.padEnd(11)} ${(w.startMs / 1000).toFixed(1).padStart(6)}s -> ${(w.endMs / 1000).toFixed(1).padStart(6)}s  (${((w.endMs - w.startMs) / 1000).toFixed(1)}s)`)
}
const pushed = placed.filter((l) => l.pushedMs > 0)
if (pushed.length) {
  console.log(`${pushed.length} line(s) pushed later than their target atMs (estimate collision):`)
  for (const l of pushed) console.log(`  [${l.beat}] +${l.pushedMs}ms: "${l.text.slice(0, 50)}..."`)
}
