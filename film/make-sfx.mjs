// Generate the sound effects with ffmpeg's own synths.
//
// No files to download, no licences to worry about, and they are reproducible:
// delete build/sfx and run this again for byte-identical results.
//
// Everything here is deliberately quiet and short. A demo film that startles a
// judge with a loud notification has cost more than it gained, so peaks sit
// well under the voice and nothing has a hard attack.
//
//   node film/make-sfx.mjs

import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, 'build', 'sfx')
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

const ff = (args) => execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args])

/** A message landing. Two soft partials, fast decay — a tap, not a ping. */
const tick = () =>
  ff([
    '-f', 'lavfi', '-i', 'sine=frequency=880:duration=0.16',
    '-f', 'lavfi', '-i', 'sine=frequency=1320:duration=0.12',
    '-filter_complex',
    '[0:a]volume=0.5[a];[1:a]volume=0.22[b];[a][b]amix=inputs=2:normalize=0,' +
      'afade=t=out:st=0.03:d=0.13,volume=0.30',
    '-ar', '48000', '-ac', '2', join(out, 'tick.wav'),
  ])

/** Somebody is waiting on somebody else. Lower, slower, faintly unresolved. */
const pending = () =>
  ff([
    '-f', 'lavfi', '-i', 'sine=frequency=420:duration=0.26',
    '-af', 'afade=t=in:st=0:d=0.02,afade=t=out:st=0.08:d=0.18,volume=0.18',
    '-ar', '48000', '-ac', '2', join(out, 'pending.wav'),
  ])

/** The commit. A major triad — the only genuinely satisfying sound in the film. */
const chord = () =>
  ff([
    '-f', 'lavfi', '-i', 'sine=frequency=523.25:duration=1.1',
    '-f', 'lavfi', '-i', 'sine=frequency=659.25:duration=1.1',
    '-f', 'lavfi', '-i', 'sine=frequency=783.99:duration=1.1',
    '-f', 'lavfi', '-i', 'sine=frequency=1046.5:duration=1.1',
    '-filter_complex',
    '[0:a]volume=0.42[a];[1:a]volume=0.32[b];[2:a]volume=0.26[c];[3:a]volume=0.14[d];' +
      '[a][b][c][d]amix=inputs=4:normalize=0,afade=t=in:st=0:d=0.012,' +
      'afade=t=out:st=0.22:d=0.88,volume=0.34',
    '-ar', '48000', '-ac', '2', join(out, 'chord.wav'),
  ])

/** A scene change. Filtered noise, no pitch, barely there. */
const whoosh = () =>
  ff([
    '-f', 'lavfi', '-i', 'anoisesrc=duration=0.42:color=brown:amplitude=0.5',
    '-af', 'highpass=f=300,lowpass=f=2600,afade=t=in:st=0:d=0.14,' +
      'afade=t=out:st=0.16:d=0.26,volume=0.13',
    '-ar', '48000', '-ac', '2', join(out, 'whoosh.wav'),
  ])

/** A refusal. One flat, low, final note. Nothing pretty about it. */
const refuse = () =>
  ff([
    '-f', 'lavfi', '-i', 'sine=frequency=196:duration=0.5',
    '-af', 'afade=t=in:st=0:d=0.01,afade=t=out:st=0.12:d=0.38,volume=0.26',
    '-ar', '48000', '-ac', '2', join(out, 'refuse.wav'),
  ])

/** A line of terminal output. Very short, very dry. */
const key = () =>
  ff([
    '-f', 'lavfi', '-i', 'anoisesrc=duration=0.05:color=white:amplitude=0.4',
    '-af', 'highpass=f=1200,lowpass=f=5200,afade=t=out:st=0.008:d=0.04,volume=0.10',
    '-ar', '48000', '-ac', '2', join(out, 'key.wav'),
  ])

/** A nearly subliminal cinematic bed: warm low fundamentals, filtered air,
 * and a very slow pulse. It gives the cuts continuity without turning a
 * product demo into a trailer or fighting the voice. */
const bed = () =>
  ff([
    '-f', 'lavfi', '-i', 'sine=frequency=55:duration=191',
    '-f', 'lavfi', '-i', 'sine=frequency=82.41:duration=191',
    '-f', 'lavfi', '-i', 'anoisesrc=duration=191:color=brown:amplitude=0.08',
    '-filter_complex',
    '[0:a]volume=0.045[a];[1:a]volume=0.022[b];[2:a]lowpass=f=700,highpass=f=80,volume=0.09[c];' +
      '[a][b][c]amix=inputs=3:normalize=0,lowpass=f=1200,' +
      'afade=t=in:st=0:d=3,afade=t=out:st=185:d=6,volume=0.42',
    '-ar', '48000', '-ac', '2', join(out, 'bed.wav'),
  ])

for (const [name, make] of Object.entries({ tick, pending, chord, whoosh, refuse, key, bed })) {
  make()
  console.log('  built', name)
}
console.log('sfx in', out)
