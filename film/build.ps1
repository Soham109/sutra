# Build the demo film, end to end, from nothing.
#
#   powershell -ExecutionPolicy Bypass -File film/build.ps1
#
# Everything is generated offline: the narration comes from the speech
# synthesiser Windows already ships, the sound effects from ffmpeg's own
# oscillators, and the picture from headless Chrome asked for one frame at a
# time. No keys, no uploads, no stock assets, and running it twice gives the
# same film.
#
#   -Fast    half frame rate and a quicker encode, for checking a change
#   -SkipVoice / -SkipSfx   reuse what is already in build/

param(
  [switch]$Fast,
  [switch]$SkipVoice,
  [switch]$SkipSfx
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here
Set-Location $root

$fps = if ($Fast) { 15 } else { 30 }

function Step($n, $what) { Write-Host "" ; Write-Host "[$n] $what" -ForegroundColor Cyan }

Step 1 "narration (Windows speech synthesis)"
if ($SkipVoice -and (Test-Path "$here\build\voice.json")) {
  Write-Host "  reusing build/voice"
} else {
  powershell -ExecutionPolicy Bypass -File "$here\build-narration.ps1"
}

Step 2 "sound effects (ffmpeg oscillators)"
if ($SkipSfx -and (Test-Path "$here\build\sfx")) {
  Write-Host "  reusing build/sfx"
} else {
  node "$here\make-sfx.mjs"
}

Step 3 "frames (headless Chrome, one per timestamp)"
node "$here\render.mjs" --fps $fps

Step 4 "encode"
node "$here\assemble.mjs" --fps $fps

Write-Host ""
Write-Host "done -> film\sutra-demo.mp4" -ForegroundColor Green
