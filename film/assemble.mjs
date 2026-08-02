// Frames + narration + sound effects -> one MP4.
//
// The picture is already exact (render.mjs asked for each frame by timestamp),
// so this only has to place audio on the same clock and encode once. Every
// sound is positioned by `adelay` in milliseconds against the film clock, which
// is the same clock the frames were rendered against — so sync is arithmetic
// rather than something to nudge by hand.
//
//   node film/assemble.mjs [--fps 30] [--out sutra-demo.mp4]

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const build = join(here, 'build')
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}

const frames = join(build, arg('frames', 'frames'))

const meta = existsSync(join(build, 'frames.json'))
  ? JSON.parse(readFileSync(join(build, 'frames.json'), 'utf8'))
  : {}
const FPS = Number(arg('fps', meta.fps ?? 30))
const OUT = join(here, arg('out', 'sutra-demo.mp4'))

if (!existsSync(frames) || readdirSync(frames).length === 0) {
  console.error('No frames. Run: node film/render.mjs')
  process.exit(1)
}

// Windows PowerShell 5.1 writes a byte-order mark with -Encoding utf8, and
// JSON.parse refuses it. voice.json comes from PowerShell, so strip it.
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''))

const voice = existsSync(join(build, 'voice.json')) ? readJson(join(build, 'voice.json')) : []
const cues = existsSync(join(here, 'sfx.json')) ? readJson(join(here, 'sfx.json')).cues ?? [] : []
const masterVoice = ['voiceover.wav', 'voiceover.m4a', 'voiceover.mp3']
  .map((name) => join(here, name))
  .find((file) => existsSync(file))

// -- build the audio graph ---------------------------------------------------
// Each clip is an input, delayed to its own start, then everything is summed.
// `normalize=0` on the mix matters: amix normalises by input count by default,
// so adding one more sound effect would otherwise quietly duck the narration
// across the whole film.
const inputs = []
const filters = []
const labels = []

let clips = 0
const add = (file, atMs, gain) => {
  // Input 0 is the frame sequence, so clips start at 1. Count FILES, not
  // array slots — each push adds both the '-i' flag and the path.
  const idx = ++clips
  inputs.push('-i', file)
  const l = `a${idx}`
  filters.push(
    `[${idx}:a]adelay=${Math.max(0, Math.round(atMs))}|${Math.max(0, Math.round(atMs))},volume=${gain}[${l}]`,
  )
  labels.push(`[${l}]`)
}

if (masterVoice) add(masterVoice, 0, 1.0)
else for (const line of voice) add(join(build, 'voice', line.file), line.atMs, 1.0)
for (const cue of cues) {
  const f = join(build, 'sfx', `${cue.sound}.wav`)
  if (existsSync(f)) add(f, cue.atMs, cue.gain ?? 1.0)
  else console.warn('  no such sound, skipping:', cue.sound)
}

const args = [
  '-y', '-hide_banner',
  '-framerate', String(FPS),
  '-i', join(frames, 'f%06d.png'),
  ...inputs,
]

if (labels.length > 0) {
  filters.push(`${labels.join('')}amix=inputs=${labels.length}:normalize=0,highpass=f=35,alimiter=limit=0.92:attack=8:release=80[mix]`)
  args.push('-filter_complex', filters.join(';'), '-map', '0:v', '-map', '[mix]')
} else {
  console.warn('  no audio found — rendering silent')
  args.push('-map', '0:v')
}

// The narration can run a fraction past the last frame — the voice is
// measured, not stretched, so it lands where it lands. Holding the final
// frame for a beat is both the fix and the right ending anyway: the closing
// card stays up while the last line finishes, instead of cutting mid-word.
const voiceEndsMs = !masterVoice && voice.length
  ? Math.max(...voice.map((l) => l.atMs + l.durationMs))
  : 0
const filmEndsMs = (meta.duration ?? 0)
const holdSec = Math.max(0.8, (voiceEndsMs - filmEndsMs) / 1000 + 0.8)

args.push(
  '-vf', `tpad=stop_mode=clone:stop_duration=${holdSec.toFixed(2)}`,
  '-c:v', 'libx264',
  '-preset', 'slow',
  '-crf', '17',
  // yuv420p or it will not play in QuickTime, PowerPoint, or half of Twitter.
  '-pix_fmt', 'yuv420p',
  '-movflags', '+faststart',
  '-r', String(FPS),
)
if (labels.length > 0) args.push('-c:a', 'aac', '-b:a', '192k', '-ar', '48000')
args.push(OUT)

console.log(`encoding ${readdirSync(frames).length} frames + ${masterVoice ? 'human/master voiceover' : voice.length + ' generated lines'} + ${cues.length} cues`)
execFileSync('ffmpeg', args, { stdio: ['ignore', 'inherit', 'inherit'] })

const probe = execFileSync('ffprobe', [
  '-v', 'error',
  '-show_entries', 'format=duration,size',
  '-of', 'default=noprint_wrappers=1',
  OUT,
]).toString().trim()

console.log(`\n${OUT}\n${probe}`)
