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
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
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
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.18',
    '-f', 'lavfi', '-i', 'sine=frequency=660:duration=0.14',
    '-filter_complex',
    '[0:a]volume=0.34[a];[1:a]volume=0.12[b];[a][b]amix=inputs=2:normalize=0,' +
      'lowpass=f=1400,afade=t=in:st=0:d=0.018,afade=t=out:st=0.045:d=0.135,volume=0.22',
    '-ar', '48000', '-ac', '2', join(out, 'tick.wav'),
  ])

/** Somebody is waiting on somebody else. Lower, slower, faintly unresolved. */
const pending = () =>
  ff([
    '-f', 'lavfi', '-i', 'sine=frequency=330:duration=0.3',
    '-af', 'lowpass=f=900,afade=t=in:st=0:d=0.035,afade=t=out:st=0.09:d=0.21,volume=0.13',
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
    '-f', 'lavfi', '-i', 'anoisesrc=duration=0.52:color=brown:amplitude=0.35',
    '-af', 'highpass=f=90,lowpass=f=1100,afade=t=in:st=0:d=0.2,' +
      'afade=t=out:st=0.2:d=0.32,volume=0.08',
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

/** A quiet, genuinely musical bed built from a repeating four-chord pad,
 * sparse felt-like arpeggio and a low pulse. Every note fades to zero before
 * the next one, so there are no discontinuities or sharp digital clicks. */
const bed = () => {
  const music = join(out, '_music')
  mkdirSync(music, { recursive: true })
  const chords = [
    [110.00, 130.81, 164.81, 220.00], // Am7
    [87.31, 110.00, 130.81, 174.61],  // Fmaj7
    [65.41, 98.00, 130.81, 196.00],   // C
    [98.00, 123.47, 146.83, 196.00],  // Gsus
  ]
  const chordFiles = []
  chords.forEach((notes, i) => {
    const file = join(music, `chord-${i}.wav`)
    const inputs = notes.flatMap((frequency) => ['-f', 'lavfi', '-i', `sine=frequency=${frequency}:duration=4`])
    const labels = notes.map((_, n) => `[${n}:a]volume=${n === 0 ? 0.09 : 0.045}[n${n}]`).join(';')
    const mix = notes.map((_, n) => `[n${n}]`).join('')
    ff([
      ...inputs,
      '-filter_complex', `${labels};${mix}amix=inputs=${notes.length}:normalize=0,lowpass=f=1200,afade=t=in:d=0.65,afade=t=out:st=3.25:d=0.75,volume=0.36`,
      '-ar', '48000', '-ac', '2', file,
    ])
    chordFiles.push(file)
  })

  const padList = []
  for (let i = 0; i < 27; i++) padList.push(`file '${chordFiles[i % chordFiles.length].replaceAll("'", "'\\''")}'`)
  const padManifest = join(music, 'pad.txt')
  writeFileSync(padManifest, padList.join('\n'))
  const pad = join(music, 'pad.wav')
  ff(['-f', 'concat', '-safe', '0', '-i', padManifest, '-t', '106', '-ar', '48000', '-ac', '2', pad])

  const uniqueNotes = [...new Set(chords.flat())]
  const noteFiles = new Map()
  uniqueNotes.forEach((frequency) => {
    const file = join(music, `note-${String(frequency).replace('.', '_')}.wav`)
    ff([
      '-f', 'lavfi', '-i', `sine=frequency=${frequency * 2}:duration=0.5`,
      '-f', 'lavfi', '-i', `sine=frequency=${frequency * 4}:duration=0.5`,
      '-filter_complex', '[0:a]volume=0.13[a];[1:a]volume=0.025[b];[a][b]amix=inputs=2:normalize=0,lowpass=f=1800,afade=t=in:d=0.035,afade=t=out:st=0.08:d=0.42,volume=0.18',
      '-ar', '48000', '-ac', '2', file,
    ])
    noteFiles.set(frequency, file)
  })
  const arpList = []
  for (let bar = 0; bar < 27; bar++) {
    const notes = chords[bar % chords.length]
    const pattern = [0, 2, 1, 3, 1, 2, 0, 2]
    pattern.forEach((n) => arpList.push(`file '${noteFiles.get(notes[n]).replaceAll("'", "'\\''")}'`))
  }
  const arpManifest = join(music, 'arp.txt')
  writeFileSync(arpManifest, arpList.join('\n'))
  const arp = join(music, 'arp.wav')
  ff(['-f', 'concat', '-safe', '0', '-i', arpManifest, '-t', '106', '-ar', '48000', '-ac', '2', arp])

  const pulse = join(music, 'pulse.wav')
  ff([
    '-f', 'lavfi', '-i', 'sine=frequency=58:duration=2',
    '-af', 'lowpass=f=180,afade=t=in:d=0.035,afade=t=out:st=0.12:d=0.7,volume=0.05',
    '-ar', '48000', '-ac', '2', pulse,
  ])
  const pulseManifest = join(music, 'pulse.txt')
  writeFileSync(pulseManifest, Array.from({ length: 53 }, () => `file '${pulse.replaceAll("'", "'\\''")}'`).join('\n'))
  const rhythm = join(music, 'rhythm.wav')
  ff(['-f', 'concat', '-safe', '0', '-i', pulseManifest, '-t', '106', '-ar', '48000', '-ac', '2', rhythm])

  ff([
    '-i', pad, '-i', arp, '-i', rhythm,
    '-f', 'lavfi', '-i', 'anoisesrc=duration=106:color=brown:amplitude=0.015',
    '-filter_complex',
    '[0:a]volume=0.95[p];[1:a]volume=0.75[a];[2:a]volume=0.9[r];[3:a]lowpass=f=600,highpass=f=90,volume=0.05[n];' +
      '[p][a][r][n]amix=inputs=4:normalize=0,afade=t=in:d=2.5,afade=t=out:st=100:d=6,' +
      'acompressor=threshold=-28dB:ratio=1.6:attack=30:release=240,loudnorm=I=-27:TP=-5:LRA=5',
    '-t', '106', '-ar', '48000', '-ac', '2', join(out, 'bed.wav'),
  ])
}

for (const [name, make] of Object.entries({ tick, pending, chord, whoosh, refuse, key, bed })) {
  make()
  console.log('  built', name)
}
console.log('sfx in', out)
