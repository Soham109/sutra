#!/usr/bin/env node
// Run the NANDA Town plugin test suite (or town_scene) with the local venv.
//   node scripts/nanda-run.mjs scene [--mode live]
//   node scripts/nanda-run.mjs test
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = join(root, 'nanda-town-prava')
const win = process.platform === 'win32'
const py = join(pkg, '.venv', win ? 'Scripts/python.exe' : 'bin/python')

if (!existsSync(py)) {
  console.error('Missing nanda-town-prava/.venv — create it first:')
  console.error('  cd nanda-town-prava')
  console.error('  uv venv --python 3.12 .venv')
  console.error('  .venv/Scripts/python -m pip install "nest-core[plugins]" -e ".[dev]"')
  process.exit(1)
}

const [cmd, ...rest] = process.argv.slice(2)
const args =
  cmd === 'test'
    ? ['-m', 'pytest', '-q', ...rest]
    : cmd === 'scene' || !cmd
      ? [join(pkg, 'scripts', 'town_scene.py'), ...(cmd === 'scene' ? rest : [cmd, ...rest].filter(Boolean))]
      : null

if (!args) {
  console.error('Usage: node scripts/nanda-run.mjs <scene|test> [args...]')
  process.exit(2)
}

const r = spawnSync(py, args, { stdio: 'inherit', cwd: pkg })
process.exit(r.status ?? 1)
