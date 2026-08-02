// Keyless cloud-neural narration through Microsoft Edge TTS. The generator is
// intentionally separate from assembly: once built, audio remains reproducible
// locally and the film can be re-encoded without network access.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, 'build', 'voice')
const spec = JSON.parse(readFileSync(join(here, 'narration.json'), 'utf8'))
// Match SubChat's proven keyless narration path exactly: Microsoft's newest
// multilingual neural generation, neutral pitch, and only a light pace lift.
// Avoiding pitch manipulation is important—it is what made the old cut sound
// synthetic even though the underlying voice was neural.
const voices = [
  'en-US-AndrewMultilingualNeural',
  'en-US-AvaMultilingualNeural',
  'en-US-EmmaMultilingualNeural',
  'en-US-BrianNeural',
]
const preferredVoice = process.env.SUTRA_VOICE || voices[0]
const edge = process.env.EDGE_TTS_BIN || '/tmp/sutra-edge-tts/bin/edge-tts'
if (!existsSync(edge)) throw new Error(`edge-tts CLI not found at ${edge}`)

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

const manifest = []
for (let i = 0; i < spec.lines.length; i++) {
  const line = spec.lines[i]
  const stem = `v${String(i).padStart(3, '0')}`
  const raw = join(out, `${stem}.mp3`)
  const wav = join(out, `${stem}.wav`)
  const voice = preferredVoice
  execFileSync(edge, [
    '--voice', voice,
    '--rate=+4%',
    '--pitch=+0Hz',
    '--text', line.text,
    '--write-media', raw,
  ])
  const rawDuration = Number(execFileSync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', raw,
  ], { encoding: 'utf8' }).trim())
  const fadeOutAt = Math.max(0.1, rawDuration - 0.12)
  execFileSync('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error', '-i', raw,
    '-af', `highpass=f=85,lowpass=f=10000,deesser=i=0.2:m=0.45:f=0.5,acompressor=threshold=-20dB:ratio=2:attack=12:release=180,afade=t=in:st=0:d=0.04,afade=t=out:st=${fadeOutAt.toFixed(3)}:d=0.12,loudnorm=I=-16:TP=-1.5:LRA=7`,
    '-ar', '48000', '-ac', '2', wav,
  ])
  rmSync(raw, { force: true })

  const durationMs = Math.round(Number(execFileSync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', wav,
  ], { encoding: 'utf8' }).trim()) * 1000)
  const minimumPlausibleMs = Math.round(line.text.trim().split(/\s+/).length / 5 * 1000)
  if (durationMs < minimumPlausibleMs) {
    throw new Error(`Narration line ${i} is truncated: ${durationMs}ms for ${line.text.length} characters.`)
  }
  manifest.push({ file: `${stem}.wav`, atMs: line.atMs, durationMs, text: line.text, voice })
}

for (let i = 0; i < manifest.length - 1; i++) {
  const over = manifest[i].atMs + manifest[i].durationMs - manifest[i + 1].atMs
  if (over > 0) throw new Error(`Narration line ${i} overlaps the next by ${over}ms.`)
}

writeFileSync(join(here, 'build', 'voice.json'), JSON.stringify(manifest, null, 2))
console.log(`built ${manifest.length} neural narration clips with ${preferredVoice}`)
console.log(`voice ends at ${((manifest.at(-1).atMs + manifest.at(-1).durationMs) / 1000).toFixed(1)}s`)
