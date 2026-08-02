// Build a timed, mastered narration track using the best modern English voice
// installed with macOS. No network key is required. Each line remains separate
// so assemble.mjs can position it exactly on the film clock.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, 'build', 'voice')
const spec = JSON.parse(readFileSync(join(here, 'narration.json'), 'utf8'))
const voices = execFileSync('say', ['-v', '?'], { encoding: 'utf8' })
const candidates = ['Reed (English (US))', 'Flo (English (US))', 'Samantha', 'Daniel']
const voice = candidates.find((name) => voices.split('\n').some((line) => line.startsWith(name))) ?? 'Samantha'

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

const manifest = []
for (let i = 0; i < spec.lines.length; i++) {
  const line = spec.lines[i]
  const stem = `v${String(i).padStart(3, '0')}`
  const aiff = join(out, `${stem}.aiff`)
  const wav = join(out, `${stem}.wav`)

  // Slightly quick, conversational delivery. Punctuation in narration.json
  // provides the pauses; segment placement provides the editorial rhythm.
  execFileSync('say', ['-v', voice, '-r', '190', '-o', aiff, line.text])
  execFileSync('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error', '-i', aiff,
    '-af', 'highpass=f=75,lowpass=f=14500,equalizer=f=180:t=q:w=0.9:g=-1.5,equalizer=f=3200:t=q:w=1.2:g=1.8,acompressor=threshold=-20dB:ratio=2.4:attack=12:release=120:makeup=2,loudnorm=I=-17:TP=-2:LRA=7',
    '-ar', '48000', '-ac', '2', wav,
  ])
  rmSync(aiff, { force: true })

  const durationMs = Math.round(Number(execFileSync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', wav,
  ], { encoding: 'utf8' }).trim()) * 1000)
  manifest.push({ file: `${stem}.wav`, atMs: line.atMs, durationMs, text: line.text })
}

for (let i = 0; i < manifest.length - 1; i++) {
  const over = manifest[i].atMs + manifest[i].durationMs - manifest[i + 1].atMs
  if (over > 0) throw new Error(`Narration line ${i} overlaps the next by ${over}ms; tighten the copy or increase its next cue.`)
}

writeFileSync(join(here, 'build', 'voice.json'), JSON.stringify(manifest, null, 2))
console.log(`built ${manifest.length} mastered narration clips with “${voice}”`)
console.log(`voice ends at ${((manifest.at(-1).atMs + manifest.at(-1).durationMs) / 1000).toFixed(1)}s`)
