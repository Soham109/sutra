#!/usr/bin/env node
/* Build step for the client layer. No bundler, no dependencies.
 *
 *   node widget/build-bookmarklet.mjs [--base https://engine.example.com]
 *
 * Four jobs:
 *
 *   1. Inline widget/detect.js into widget/widget.js between the BEGIN/END
 *      markers. The engine only serves /widget.js (engine/src/server.ts), so
 *      the widget has to be one self-contained file — but the detector is the
 *      part with tests, so it must not be maintained twice. detect.test.mjs
 *      fails if this step has not been run.
 *
 *   2. Copy widget/detect.js to extension/detect.js for the same reason: MV3
 *      can only inject files that live inside the extension directory.
 *
 *   3. Minify widget/bookmarklet.js into a `javascript:` URL and write it to
 *      widget/bookmarklet.min.js and widget/bookmarklet.url.txt.
 *
 *   4. Drop the bookmarklet source into engine/public/widget-demo.html so the
 *      demo page can render it as a draggable link. The page rebinds it to
 *      its own origin at runtime, so one build works for localhost and prod.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..')

const args = process.argv.slice(2)
const baseArg = args.indexOf('--base')
const BASE = baseArg !== -1 ? args[baseArg + 1] : process.env.APP_BASE_URL || 'http://localhost:4100'

const BEGIN = '/* >>> BEGIN INLINED widget/detect.js'
const END = '/* <<< END INLINED widget/detect.js'

const log = []
const say = (s) => { log.push(s); console.log(s) }

// ---------------------------------------------------------------------
// 1 + 2 — the detector, inlined and copied
// ---------------------------------------------------------------------

const detect = readFileSync(join(here, 'detect.js'), 'utf8')

{
  const widgetPath = join(here, 'widget.js')
  const widget = readFileSync(widgetPath, 'utf8')
  const i = widget.indexOf(BEGIN)
  const j = widget.indexOf(END)
  if (i === -1 || j === -1) {
    console.error('widget/widget.js has lost its inline markers. Expected:\n  ' + BEGIN + ' … */\n  ' + END + ' */')
    process.exit(1)
  }
  const headEnd = widget.indexOf('\n', i) + 1
  const next = widget.slice(0, headEnd) + detect.trim() + '\n  ' + widget.slice(j)
  if (next !== widget) {
    writeFileSync(widgetPath, next)
    say(`inlined detect.js into widget/widget.js (${kb(detect)} of detector, ${kb(next)} total)`)
  } else {
    say('widget/widget.js already up to date')
  }
}

{
  const extDir = join(repo, 'extension')
  if (!existsSync(extDir)) mkdirSync(extDir, { recursive: true })
  const target = join(extDir, 'detect.js')
  const current = existsSync(target) ? readFileSync(target, 'utf8') : null
  if (current !== detect) {
    writeFileSync(target, detect)
    say(`copied detect.js to extension/detect.js (${kb(detect)})`)
  } else {
    say('extension/detect.js already up to date')
  }
}

// ---------------------------------------------------------------------
// 3 — the bookmarklet
// ---------------------------------------------------------------------

/**
 * A deliberately small minifier: strip comments, strip indentation, drop blank
 * lines. That is all.
 *
 * It does NOT join lines. This codebase omits trailing semicolons, so newlines
 * are load-bearing — `foo()` + newline + `return` becomes a syntax error the
 * moment you collapse it. A bookmarklet URL happily carries %0A, so the couple
 * of hundred bytes this costs buys correctness. Strings and regex literals are
 * tracked so a `//` inside them is never mistaken for a comment.
 */
function minify(src) {
  const out = []
  let i = 0
  let state = 'code' // code | line-comment | block-comment | ' | " | ` | regex
  while (i < src.length) {
    const c = src[i]
    const c2 = src.slice(i, i + 2)
    if (state === 'code') {
      if (c2 === '//') { state = 'line-comment'; i += 2; continue }
      if (c2 === '/*') { state = 'block-comment'; i += 2; continue }
      if (c === "'" || c === '"' || c === '`') { state = c; out.push(c); i++; continue }
      if (c === '/' && isRegexStart(out)) { state = 'regex'; out.push(c); i++; continue }
      out.push(c)
      i++
      continue
    }
    if (state === 'line-comment') {
      if (c === '\n') { state = 'code'; out.push('\n') }
      i++
      continue
    }
    if (state === 'block-comment') {
      if (c2 === '*/') { state = 'code'; i += 2; continue }
      i++
      continue
    }
    if (state === 'regex') {
      out.push(c)
      if (c === '\\') { out.push(src[i + 1]); i += 2; continue }
      if (c === '/') state = 'code'
      i++
      continue
    }
    out.push(c) // inside a string
    if (c === '\\') { out.push(src[i + 1]); i += 2; continue }
    if (c === state) state = 'code'
    i++
  }
  return out
    .join('')
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, '').replace(/^[ \t]+/, ''))
    .filter(Boolean)
    .join('\n')
}

// `/` starts a regex literal only where a value is expected.
function isRegexStart(out) {
  for (let k = out.length - 1; k >= 0; k--) {
    const ch = out[k]
    if (/\s/.test(ch)) continue
    return !/[a-zA-Z0-9_$)\]]/.test(ch)
  }
  return true
}

const bookmarkletSrc = readFileSync(join(here, 'bookmarklet.js'), 'utf8')
const minified = minify(bookmarkletSrc)

// Sanity: the minifier is homegrown, so refuse to ship output that will not parse.
try {
  // eslint-disable-next-line no-new-func
  new Function(minified.replace(/__SUTRA_BASE__/g, 'https://example.test'))
} catch (e) {
  console.error('minified bookmarklet does not parse:', e.message)
  console.error(minified.slice(0, 400))
  process.exit(1)
}

function urlFor(base) {
  const body = minified.replace(/__SUTRA_BASE__/g, base)
  // Encode what breaks in an href, a bookmark field or an HTML attribute.
  // Everything else stays readable, because nobody should paste a
  // `javascript:` URL they cannot read.
  return (
    'javascript:' +
    encodeURI(body)
      .replace(/#/g, '%23')
      .replace(/&/g, '%26')
      .replace(/\?/g, '%3F')
      .replace(/"/g, '%22')
      .replace(/'/g, '%27')
      .replace(/</g, '%3C')
      .replace(/>/g, '%3E')
  )
}

const url = urlFor(BASE)
writeFileSync(join(here, 'bookmarklet.min.js'), minified + '\n')
writeFileSync(
  join(here, 'bookmarklet.url.txt'),
  '# Paste this into a bookmark\'s URL field (built for ' + BASE + ').\n' +
    '# Rebuild for another engine: node widget/build-bookmarklet.mjs --base https://your-engine\n' +
    url + '\n',
)
say(`bookmarklet: ${bookmarkletSrc.length}b source -> ${minified.length}b minified -> ${url.length}b javascript: URL`)
if (url.length > 8000) say('  ! over 8KB — some browsers truncate bookmark URLs')

// ---------------------------------------------------------------------
// 4 — hand it to the demo page
// ---------------------------------------------------------------------

{
  const demoPath = join(repo, 'engine', 'public', 'widget-demo.html')
  if (existsSync(demoPath)) {
    const demo = readFileSync(demoPath, 'utf8')
    const open = '<script type="text/plain" id="bookmarklet-src">'
    const close = '</script>'
    const i = demo.indexOf(open)
    if (i === -1) {
      say('! widget-demo.html has no #bookmarklet-src slot — skipped')
    } else {
      const j = demo.indexOf(close, i)
      // The demo page substitutes its own origin at runtime, so ship the
      // placeholder rather than a baked-in host.
      const payload = minified.replace(/<\/script/gi, '<\\/script')
      const next = demo.slice(0, i + open.length) + payload + demo.slice(j)
      if (next !== demo) {
        writeFileSync(demoPath, next)
        say('injected bookmarklet source into engine/public/widget-demo.html')
      } else {
        say('widget-demo.html already up to date')
      }
    }
  }
}

function kb(s) {
  return (Buffer.byteLength(s, 'utf8') / 1024).toFixed(1) + 'kb'
}

say('')
say('next: node --test widget/detect.test.mjs')
