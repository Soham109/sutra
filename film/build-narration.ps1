# Generate the voice track from film/narration.json.
#
# Windows ships a speech synthesiser, so the narration is produced offline with
# no key, no service and no upload -- which also means it is reproducible: run
# this again and you get the same track.
#
# Each line becomes its own WAV so it can be placed at an exact millisecond on
# the film clock. Nothing is stretched to fit; instead this measures what each
# line really takes and tells you where lines would collide, so the script can
# be tightened rather than the audio mangled.
#
#   powershell -ExecutionPolicy Bypass -File film/build-narration.ps1

$ErrorActionPreference = 'Stop'
$here  = Split-Path -Parent $MyInvocation.MyCommand.Path
$build = Join-Path $here 'build\voice'
New-Item -ItemType Directory -Force $build | Out-Null
Get-ChildItem $build -Filter *.wav -ErrorAction SilentlyContinue | Remove-Item -Force

$spec  = Get-Content (Join-Path $here 'narration.json') -Raw | ConvertFrom-Json

Add-Type -AssemblyName System.Speech
$voice = New-Object System.Speech.Synthesis.SpeechSynthesizer

$available = $voice.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name }
if ($available -contains $spec.voice) {
  $voice.SelectVoice($spec.voice)
} else {
  Write-Host "voice '$($spec.voice)' not installed; using the default. Available: $($available -join ', ')"
}
$voice.Rate = $spec.rate

# Synthesise every line first, then lay them out. A line's atMs is the EARLIEST
# it may speak, not a promise -- if the previous line is still going, this one
# waits. Two voices talking over each other is never the right answer, and
# stretching audio to hit a mark makes it sound like a machine reading faster.
$manifest = @()
$i = 0
$cursor = 0
$pushed = 0
foreach ($line in $spec.lines) {
  $name = 'v{0:d3}.wav' -f $i
  $path = Join-Path $build $name
  $voice.SetOutputToWaveFile($path)
  $voice.Speak($line.text)

  $seconds = [double](ffprobe -v error -show_entries format=duration -of csv=p=0 $path)
  $ms = [int][math]::Round($seconds * 1000)

  $startAt = [math]::Max($line.atMs, $cursor)
  if ($startAt -gt $line.atMs) {
    $pushed++
    Write-Host ("  pushed line {0} by {1}ms -- the one before it was still speaking" -f $i, ($startAt - $line.atMs))
  }
  $cursor = $startAt + $ms + $spec.gapMs

  $manifest += [pscustomobject]@{
    file       = $name
    atMs       = $startAt
    wantedAtMs = $line.atMs
    durationMs = $ms
    text       = $line.text
  }
  $i++
}
$voice.Dispose()

$clash = $pushed

$last = $manifest[-1]
$totalMs = $last.atMs + $last.durationMs
$manifest | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $here 'build\voice.json') -Encoding utf8

Write-Host ""
Write-Host ("{0} lines | voice ends at {1:n1}s | {2} line(s) pushed later" -f $manifest.Count, ($totalMs / 1000), $clash)
if ($clash -gt 0) { Write-Host "Those lines now start later than written. If that puts a line over the wrong picture, shorten it." }
