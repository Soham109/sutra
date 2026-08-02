# Building the film on a fresh machine

Everything here is source. The render output — narration audio, sound effects,
PNG frames and the encoded MP4 — is gitignored and rebuilt locally, because a
full render is roughly 6.7 GB of frames plus a ~30 MB video, all reproducible
from what is committed.

## Prerequisites

| | |
|---|---|
| Node | 22.5 or newer (`node --version`) |
| ffmpeg + ffprobe | on `PATH` (`ffmpeg -version`) |
| Chrome or Edge | for headless frame capture |
| Internet | the neural voice calls Microsoft's TTS endpoint |

From the repository root, `npm install`. The film uses `puppeteer-core`, which
does **not** download a browser — it drives one already installed. If Chrome
isn't at the default location, set `CHROME_PATH`:

```powershell
$env:CHROME_PATH = "C:\Program Files\Google\Chrome\Application\chrome.exe"
```

```bash
export CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
```

## Look at it before you render anything

A full render takes a long time and eats disk. The film is a deterministic
HTML document — every frame is a pure function of time — so you can scrub it in
a browser first and iterate on the look for free:

```
npm run film:preview
```

Then open `http://localhost:4173`. Drag the timeline. What you see is exactly
what renders, because `FILM.seek(t)` paints the same state either way. Never
start a render to check whether something looks right.

## The build, in order

```
npm run film:voice      # narration clips     ~1 min, needs internet
node film/make-sfx.mjs  # music bed + effects ~30 s
npm run film:render     # PNG frames          20-40 min, ~6.7 GB
npm run film:assemble   # mux to MP4          ~2 min
```

Or `powershell -File film/build.ps1` to run all four.

Output lands at `film/build/sutra-demo.mp4`.

### Re-rendering one scene

Frame capture is the slow step, and scenes are independent. `film/render.mjs`
accepts a time range, so a change to one scene doesn't cost a full pass:

```
node film/render.mjs --from 24 --to 44
```

Then re-run the assemble step. Frames outside the range are reused from
`film/build/frames/`.

### Changing the voice

`film/build-narration-neural.mjs` uses `msedge-tts` — real neural voices, no API
key. The voice id is at the top of the file. `en-US-GuyNeural`,
`en-US-ChristopherNeural`, `en-US-AriaNeural` and `en-GB-RyanNeural` are all
worth trying; generate a line with each and listen before committing to one.

**Do not fall back to Windows SAPI** (`System.Speech.SpeechSynthesizer`, voices
David and Zira). It is the 2005-era robot voice and no amount of animation
rescues a film that sounds like it. `build-narration.ps1` still exists for
reference; treat it as a last resort on a machine with no internet.

`build-narration-macos.mjs` uses the `say` command and Apple's voices, which are
decent — use it if you're building on a Mac and prefer them.

## Traps this pipeline has already hit

Each of these cost real debugging time. They are handled in the current code —
don't reintroduce them.

**Narration is slower than its word count.** Every scene boundary must come
from `ffprobe`-measured clip durations, never from an estimate in the script. An
early cut had eighteen places where narration ran past its scene and overlapped
the next one. The assembler measures and auto-pushes; keep it that way.

**ffmpeg input indices are not array lengths.** `args.push('-i', file)` adds
*two* entries, so `inputs.length` double-counts and every filter reference is
wrong. Count inputs with a dedicated counter.

**A scene not listed in `index.html` renders as nothing** — silently. Scenes 5
through 9 were once missing, and only 82 seconds of a 190-second film came out,
with no error anywhere. After adding a scene, check it's in the script tags.

**puppeteer `setContent` with `waitUntil: 'networkidle0'` hangs** on a page that
makes no network requests, which is every page here. Use `domcontentloaded` plus
a short settle delay.

**PowerShell writes JSON with a BOM** that `JSON.parse` refuses. If a `.ps1`
step writes a manifest, strip the BOM when reading it.

**PowerShell 5.1 mangles non-ASCII in `.ps1` files.** Em-dashes and curly quotes
in a script become mojibake. Keep `.ps1` files ASCII-only; put the real
typography in the JSON and JS, which are UTF-8.

**Frames are large.** Clear `film/build/frames/` between full renders if disk is
tight, but keep it if you plan to re-render only a range.

## What must stay true in any edit

The narration and captions are bound by the project's claim rules:

- Charges are **sequential with idempotent recovery**. Never "atomic", never
  "simultaneous", never "at the same moment". The film *shows* the sequence
  deliberately — that's a feature, not something to smooth over.
- "Everyone approves, or nobody is charged" is correct: it describes the
  decision gate, not simultaneous charging. Don't "improve" it.
- Say **sandbox** and **test money** out loud in the receipt beat.
- Every figure on screen is the real one: ₹18,600 total, ₹9,300 each.
- Never claim a merchant's checkout accepted several cards.

## The proof shot

`film/assets/real/` holds captures of the live product. The important one is
the receipt for group `gs_01KZ1SW0EXN2V3N4Y1V0K5E4H4` — a completed two-card
charge on Prava's sandbox, publicly readable at
`https://sutra-gmp.vercel.app/receipt`.

If the captures are missing, re-take them from the live site rather than
mocking them up. The whole argument of the film is that this actually works;
a staged screenshot would undo it.
