#!/usr/bin/env tsx
// nanda — publish this engine into Project NANDA's discovery layer, and prove
// it is reachable before doing so.
//
//   nanda check                    fetch our own well-known URLs and validate them
//   nanda skill-submit             register the SkillMD with Nanda Town
//   nanda index-register           NANDA Index v2: account, org record, DNS challenge
//   nanda index-register --verify  check the DNS TXT and activate the record
//
// Environment:
//   SUTRA_PUBLIC_URL   the PUBLIC base URL of the engine (falls back to APP_BASE_URL)
//   NANDA_EMAIL        account email for the NANDA Index (index-register only)
//   NANDA_PASSWORD     account password                  (index-register only)
//   NANDA_ORG_ID       org_id to claim, default "sutra"  (index-register only)
//   SKILL_AUTHOR       author shown on the Nanda Town listing, default "sutra"
//
// Two rules this tool will not bend:
//   1. It refuses to submit a loopback or private-network URL. Both registries
//      PROBE what you give them and badge the listing reachable or unreachable;
//      submitting http://localhost:4100 does not fail loudly, it fails quietly
//      and permanently in public.
//   2. It never prints a password or a bearer token. Tokens are held in memory
//      for the length of one command and reported as <redacted>.

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ENGINE_ENDPOINTS,
  WELL_KNOWN,
  abs,
  buildAgentCard,
  buildAgentFacts,
  buildCatalog,
  buildExtensionDocument,
  buildIndexRecord,
  isLoopback,
  normalizeBaseUrl,
  type DiscoveryConfig,
} from '../../engine/src/discovery/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..')

const SKILL_REGISTRY = process.env.NANDA_SKILLS_API ?? 'https://nandatown.projectnanda.org/api/skills'
const INDEX_API = process.env.NANDA_INDEX_API ?? 'https://api.nandaindex.org'

const RAW_BASE = process.env.SUTRA_PUBLIC_URL ?? process.env.APP_BASE_URL ?? 'http://localhost:4100'

const argv = process.argv.slice(2)
const command = argv[0]
const flag = (name: string): boolean => argv.includes(`--${name}`)
const opt = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}

const ok = (s: string) => console.log(`  ✓ ${s}`)
const bad = (s: string) => console.log(`  ✗ ${s}`)
const note = (s: string) => console.log(`    ${s}`)

async function main(): Promise<void> {
  switch (command) {
    case 'check':
      return check()
    case 'skill-submit':
      return skillSubmit()
    case 'index-register':
      return indexRegister()
    default:
      console.log(`usage:
  nanda check                          fetch our own well-known URLs and validate them
  nanda skill-submit [--all] [--content] [--dry-run]
                                       register the SkillMD with Nanda Town
  nanda index-register [--verify] [--update] [--dry-run]
                                       NANDA Index v2 registration and DNS challenge

  base URL comes from SUTRA_PUBLIC_URL (or APP_BASE_URL); a loopback or
  private-network address is refused, because both registries probe it.`)
      process.exit(1)
  }
}

// ---------------------------------------------------------------------------

function config(): DiscoveryConfig {
  return { baseUrl: normalizeBaseUrl(RAW_BASE) }
}

/**
 * Anything a registry will fetch must be fetchable from outside this machine.
 * Hard refusal on a real submission; a warning under --dry-run, so the body can
 * still be previewed before the engine is deployed anywhere.
 */
function requirePublicBase(): DiscoveryConfig {
  const cfg = config()
  if (isLoopback(cfg.baseUrl)) {
    const why =
      `${cfg.baseUrl} is a loopback or private address. The registry probes every URL you give it, ` +
      `from its own network — submitting this badges the listing unreachable, permanently and in public.`
    if (!flag('dry-run')) {
      throw new Error(
        `refusing to submit: ${why}\n` +
          `  Deploy the engine (or expose it), then:  SUTRA_PUBLIC_URL=https://your-host nanda ${command}`,
      )
    }
    console.log(`  ! ${why}\n  ! --dry-run, so continuing to preview only.\n`)
  }
  return cfg
}

async function getJson(url: string): Promise<{ status: number; body: unknown; type: string; text: string }> {
  const res = await fetch(url, {
    headers: { accept: 'application/json, text/markdown;q=0.9, */*;q=0.8' },
    signal: AbortSignal.timeout(20_000),
  })
  const text = await res.text()
  let body: unknown = null
  try {
    body = JSON.parse(text)
  } catch {
    body = null
  }
  return { status: res.status, body, type: res.headers.get('content-type') ?? '', text }
}

// ---------------------------------------------------------------------------
// check — prove reachability and correctness BEFORE anything is submitted
// ---------------------------------------------------------------------------

async function check(): Promise<void> {
  const cfg = config()
  console.log(`\n▶ nanda check — ${cfg.baseUrl}\n`)
  if (isLoopback(cfg.baseUrl)) {
    console.log(
      '  ! this is a loopback/private address. Fine for a local check, but a registry could never reach it.\n',
    )
  }

  let failures = 0
  const fail = (s: string) => {
    failures++
    bad(s)
  }

  // -- the A2A card, at both paths -----------------------------------------
  const expectedCard = buildAgentCard(cfg)
  for (const path of [WELL_KNOWN.agentCard, WELL_KNOWN.namedAgentCard]) {
    const url = abs(cfg, path)
    const r = await getJson(url).catch((e: Error) => ({ status: 0, body: null, type: '', text: e.message }))
    if (r.status !== 200) {
      fail(`${path} — HTTP ${r.status || 'unreachable'} ${r.text.slice(0, 120)}`)
      continue
    }
    if (!/json/.test(r.type)) fail(`${path} — content-type is ${r.type || 'missing'}, expected JSON`)
    const card = r.body as Record<string, unknown> | null
    if (!card) {
      fail(`${path} — body is not JSON`)
      continue
    }
    const missing = ['name', 'description', 'version', 'capabilities', 'skills'].filter((k) => !(k in card))
    if (missing.length) fail(`${path} — missing ${missing.join(', ')}`)
    else ok(`${path} — A2A card, ${(card.skills as unknown[]).length} skills`)
    if (JSON.stringify(card) !== JSON.stringify(expectedCard)) {
      fail(`${path} — served card differs from the one this repo generates (stale deploy?)`)
    }
    failures += badUrls(card, cfg, path).length ? 1 : 0
  }

  // -- the extension the card points at must dereference ---------------------
  {
    const url = abs(cfg, WELL_KNOWN.paymentsExtension)
    const r = await getJson(url).catch(() => ({ status: 0, body: null, type: '', text: '' }))
    if (r.status !== 200) fail(`${WELL_KNOWN.paymentsExtension} — HTTP ${r.status || 'unreachable'}`)
    else if (JSON.stringify(r.body) !== JSON.stringify(buildExtensionDocument(cfg))) {
      fail(`${WELL_KNOWN.paymentsExtension} — differs from the generated document`)
    } else ok(`${WELL_KNOWN.paymentsExtension} — extension URI dereferences`)
  }

  // -- AgentFacts, at both paths, against the real schema -------------------
  const expectedFacts = buildAgentFacts(cfg)
  for (const path of [WELL_KNOWN.agentFacts, WELL_KNOWN.agentFactsRoot]) {
    const url = abs(cfg, path)
    const r = await getJson(url).catch(() => ({ status: 0, body: null, type: '', text: '' }))
    if (r.status !== 200) {
      fail(`${path} — HTTP ${r.status || 'unreachable'}`)
      continue
    }
    const errs = agentFactsErrors(r.body)
    if (errs.length) errs.forEach((e) => fail(`${path} — ${e}`))
    else ok(`${path} — AgentFacts, required fields present`)
    if (JSON.stringify(r.body) !== JSON.stringify(expectedFacts)) {
      fail(`${path} — served facts differ from the one this repo generates (stale deploy?)`)
    }
    failures += badUrls(r.body, cfg, path).length ? 1 : 0
  }

  // -- the AI Catalog, and every card it points at --------------------------
  {
    const url = abs(cfg, WELL_KNOWN.catalog)
    const r = await getJson(url).catch(() => ({ status: 0, body: null, type: '', text: '' }))
    const cat = r.body as { specVersion?: string; entries?: { identifier: string; url: string }[] } | null
    if (r.status !== 200 || !cat?.entries) {
      fail(`${WELL_KNOWN.catalog} — HTTP ${r.status || 'unreachable'}, no entries`)
    } else {
      if (JSON.stringify({ ...cat, entries: cat.entries.map((e) => e.identifier) }).length === 0) {
        fail(`${WELL_KNOWN.catalog} — empty`)
      }
      ok(`${WELL_KNOWN.catalog} — AI Catalog specVersion ${cat.specVersion}, ${cat.entries.length} entries`)
      if (cat.specVersion !== buildCatalog(cfg).specVersion) {
        fail(`${WELL_KNOWN.catalog} — unexpected specVersion ${cat.specVersion}`)
      }
      // The whole point of a catalog is that its links resolve.
      for (const entry of cat.entries) {
        const e = await fetch(entry.url, { signal: AbortSignal.timeout(20_000) }).catch(() => null)
        if (!e || !e.ok) fail(`catalog entry "${entry.identifier}" → ${entry.url} is unreachable`)
        else ok(`catalog entry "${entry.identifier}" → ${e.status} ${e.headers.get('content-type')}`)
      }
    }
  }

  // -- the SkillMD ----------------------------------------------------------
  {
    const url = abs(cfg, WELL_KNOWN.skillMd)
    const r = await fetch(url, { signal: AbortSignal.timeout(20_000) }).catch(() => null)
    if (!r || !r.ok) {
      fail(`${WELL_KNOWN.skillMd} — ${r ? `HTTP ${r.status}` : 'unreachable'}`)
    } else {
      const type = r.headers.get('content-type') ?? ''
      const md = await r.text()
      if (!/markdown/.test(type)) fail(`${WELL_KNOWN.skillMd} — content-type is ${type}, expected text/markdown`)
      const lines = md.split(/\r?\n/)
      const baseIdx = lines.indexOf('## Base URL')
      const declared = baseIdx >= 0 ? lines[baseIdx + 1]?.trim() : undefined
      if (!lines[0]?.startsWith('# ')) fail('SKILL.md — first line is not a `# Title`')
      if (baseIdx < 0) fail('SKILL.md — no `## Base URL` section')
      if (!lines.includes('## Endpoints')) fail('SKILL.md — no `## Endpoints` section')
      if (!lines.includes('## How the agent should use this')) {
        fail('SKILL.md — no `## How the agent should use this` section')
      }
      if (declared !== cfg.baseUrl) {
        fail(`SKILL.md — declares base ${declared}, but we are serving from ${cfg.baseUrl}`)
      } else ok(`${WELL_KNOWN.skillMd} — text/markdown, base URL matches, ${lines.length} lines`)
      if (/localhost|127\.0\.0\.1/.test(md) && !isLoopback(cfg.baseUrl)) {
        fail('SKILL.md — still contains a localhost URL')
      }
    }
  }

  console.log(
    failures === 0
      ? `\n  ✓ all discovery documents reachable and consistent\n${
          isLoopback(cfg.baseUrl)
            ? '  ! but this is a local address — deploy and re-run before submitting\n'
            : '  ready to submit: nanda skill-submit\n'
        }`
      : `\n  ✗ ${failures} problem(s) — fix these before submitting to any registry\n`,
  )
  if (failures > 0) process.exit(1)
}

/** Every http(s) URL in a served document must sit under our own base. */
function badUrls(doc: unknown, cfg: DiscoveryConfig, label: string): string[] {
  const allowedExternal = new Set(['https://agentfacts.org/schema/v1'])
  const out: string[] = []
  const walk = (v: unknown): void => {
    if (typeof v === 'string') {
      if (/^https?:\/\//i.test(v) && !v.startsWith(cfg.baseUrl) && !allowedExternal.has(v)) out.push(v)
      return
    }
    if (Array.isArray(v)) return void v.forEach(walk)
    if (v && typeof v === 'object') return void Object.values(v).forEach(walk)
  }
  walk(doc)
  for (const u of out) bad(`${label} — URL not rooted at the base: ${u}`)
  return out
}

/**
 * Focused required-field validation against the vendored copy of the REAL
 * AgentFacts schema (engine/test/fixtures/agentfacts_schema.json, taken from
 * projnanda/agentfacts-format). Deliberately not a full JSON Schema engine:
 * engine/test/discovery.test.ts does the complete validation, and this is the
 * pre-flight that has to run wherever the CLI runs, with no extra dependency.
 */
function agentFactsErrors(doc: unknown): string[] {
  if (!doc || typeof doc !== 'object') return ['body is not a JSON object']
  const obj = doc as Record<string, unknown>
  const schema = JSON.parse(
    readFileSync(join(repoRoot, 'engine', 'test', 'fixtures', 'agentfacts_schema.json'), 'utf8'),
  ) as { required: string[]; properties: Record<string, { required?: string[] }> }

  const errors = schema.required.filter((k) => !(k in obj)).map((k) => `missing required "${k}"`)
  for (const [key, sub] of Object.entries(schema.properties)) {
    const value = obj[key]
    if (!sub.required || !value || typeof value !== 'object') continue
    for (const k of sub.required) {
      if (!(k in (value as Record<string, unknown>))) errors.push(`missing required "${key}.${k}"`)
    }
  }
  if (!Array.isArray(obj.skills) || obj.skills.length === 0) errors.push('skills must be a non-empty array')
  return errors
}

// ---------------------------------------------------------------------------
// skill-submit — Nanda Town SkillMD registry
// ---------------------------------------------------------------------------

/**
 * Endpoints to declare on the listing.
 *
 * The registry probes these and badges the listing reachable/unreachable, so
 * the default is only endpoints that answer a bare GET with no setup. The full
 * API — including everything that needs a POST body or a real id — is in
 * SKILL.md, which is the document agents actually read. `--all` submits
 * everything anyway, if you would rather have the completeness than the badge.
 */
function submittedEndpoints(cfg: DiscoveryConfig, all: boolean): string[] {
  const probeSafe = [
    `GET ${abs(cfg, WELL_KNOWN.skillMd)}`,
    `GET ${abs(cfg, WELL_KNOWN.agentCard)}`,
    `GET ${abs(cfg, WELL_KNOWN.agentFacts)}`,
    `GET ${abs(cfg, WELL_KNOWN.catalog)}`,
    `GET ${abs(cfg, '/v1/discover/search?q=projector')}`,
  ]
  if (!all) return probeSafe
  const rest = ENGINE_ENDPOINTS.map((e) => `${e.method} ${abs(cfg, e.path)}`)
  return [...new Set([...probeSafe, ...rest])]
}

async function skillSubmit(): Promise<void> {
  const cfg = requirePublicBase()
  const all = flag('all')
  const inline = flag('content')

  const skillUrl = abs(cfg, WELL_KNOWN.skillMd)
  console.log(`\n▶ nanda skill-submit — ${skillUrl}\n`)

  // Never submit a link we have not just proved answers. The registry runs this
  // exact check; better to fail here, where it is fixable.
  const probe = await fetch(skillUrl, { signal: AbortSignal.timeout(20_000) }).catch(() => null)
  if (!probe || !probe.ok) {
    const why = `${skillUrl} is not reachable (${probe ? `HTTP ${probe.status}` : 'connection failed'})`
    if (!flag('dry-run')) throw new Error(`${why}. Fix it first: nanda check`)
    bad(`${why} — --dry-run, previewing anyway`)
  } else {
    ok(`${skillUrl} → ${probe.status} ${probe.headers.get('content-type')}`)
  }

  const body: Record<string, unknown> = {
    name: 'sutra — group checkout (GMP/1)',
    author: process.env.SKILL_AUTHOR ?? 'sutra',
    description:
      'Buy one thing for N people, where each person pays their own share from their own card. ' +
      'One cart becomes N merchant-locked, amount-capped payment mandates committed together: everyone is charged ' +
      'in one window, or every mandate is cancelled and nobody was charged. Also coordinates the plan before the ' +
      'cart, and splits a physical restaurant bill exactly. No pooled funds, nobody fronts money, no card numbers.',
    source_type: inline ? 'content' : 'url',
    source_url: skillUrl,
    endpoints: submittedEndpoints(cfg, all).join('\n'),
    tags: [
      'payments',
      'agentic-commerce',
      'group-checkout',
      'split-payment',
      'multi-principal',
      'mandates',
      'bill-splitting',
      'gmp1',
      'prava',
      'nanda',
    ].join(', '),
  }
  if (inline) {
    // Serve-side rewriting means the served copy already carries the public
    // base; take that one rather than the repo copy, which is dev-based.
    body.content = probe?.ok
      ? await probe.clone().text()
      : readFileSync(join(repoRoot, 'SKILL.md'), 'utf8')
  }

  note(`endpoints declared: ${submittedEndpoints(cfg, all).length}${all ? ' (--all)' : ' (probe-safe)'}`)

  if (flag('dry-run')) {
    console.log(`\n  --dry-run, not submitting. Body:\n`)
    console.log(JSON.stringify({ ...body, content: inline ? '<skill.md>' : undefined }, null, 2))
    return
  }

  const res = await fetch(SKILL_REGISTRY, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  })
  const text = await res.text()
  console.log(`\n  POST ${SKILL_REGISTRY} → ${res.status}`)
  console.log(prettify(text))
  if (!res.ok) process.exit(1)

  const id = safeJson<{ skill?: { id?: string }; id?: string }>(text)
  const skillId = id?.skill?.id ?? id?.id
  if (skillId) {
    console.log(`\n  read it back:  curl ${SKILL_REGISTRY}/${skillId}`)
  }
  console.log(
    `  watch the listing for "link responded" rather than "couldn't reach link".\n` +
      `  if it says unreachable, warm the host and resubmit.\n`,
  )
}

// ---------------------------------------------------------------------------
// index-register — NANDA Index v2
// ---------------------------------------------------------------------------
//
// Verified against the live OpenAPI document at ${INDEX_API}/docs/json
// ("NANDA Index Server", 2.0.0) on 2026-08-01:
//
//   POST /auth/register {email, password, display_name?}  -> 201 {token}
//   POST /auth/login    {email, password}                 -> 200 {token}
//   POST /api/v1/orgs                     (Bearer)        -> 201 org
//   POST /api/v1/orgs/:org_id/domain-challenge (Bearer)
//        -> 200 {domain, record_name, record_type, record_value, expires_at}
//   POST /api/v1/orgs/:org_id/verify-domain    (Bearer)   -> 200 org
//
// Correction to the commonly-quoted summary: POST /api/v1/orgs requires only
// org_id, display_name and contact_email. Everything else (hosting_path,
// media_type, registry_url, identifier, publisher, tags, ttl_seconds) is
// optional — but it is what makes the record resolve to anything, so
// buildIndexRecord() sends all of it.

async function indexRegister(): Promise<void> {
  const cfg = requirePublicBase()
  const email = process.env.NANDA_EMAIL
  const password = process.env.NANDA_PASSWORD
  const orgId = process.env.NANDA_ORG_ID ?? opt('org') ?? 'sutra'

  if (!email || !password) {
    throw new Error('set NANDA_EMAIL and NANDA_PASSWORD (they are never printed or written anywhere)')
  }

  const record = buildIndexRecord(cfg, { contactEmail: email, orgId })
  console.log(`\n▶ nanda index-register — ${record.identifier} → ${record.registry_url}/agents\n`)

  if (flag('dry-run')) {
    console.log('  --dry-run, contacting nothing. Record body:\n')
    console.log(JSON.stringify({ ...record, contact_email: '<NANDA_EMAIL>' }, null, 2))
    return
  }

  // -- 1. account ----------------------------------------------------------
  const token = await authenticate(email, password)
  ok(`authenticated as ${redactEmail(email)} — token <redacted>`)

  const api = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`${INDEX_API}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        ...(init.headers as Record<string, string> | undefined),
      },
      signal: AbortSignal.timeout(30_000),
    })
    return { status: res.status, text: await res.text() }
  }

  // -- 2. verify --------------------------------------------------------
  if (flag('verify')) {
    const v = await api(`/api/v1/orgs/${orgId}/verify-domain`, { method: 'POST' })
    console.log(`  POST /api/v1/orgs/${orgId}/verify-domain → ${v.status}`)
    console.log(prettify(v.text))
    const org = safeJson<{ domain_verified?: boolean; status?: string }>(v.text)
    if (org?.domain_verified) ok(`domain verified, record status "${org.status}"`)
    else bad('domain not verified yet — DNS may still be propagating; try again in a minute')
    if (!v.status.toString().startsWith('2')) process.exit(1)
    return
  }

  // -- 3. org record -------------------------------------------------------
  let created = await api('/api/v1/orgs', { method: 'POST', body: JSON.stringify(record) })
  if (created.status === 409 && flag('update')) {
    note(`org "${orgId}" already exists — --update, so PUTting the record instead`)
    created = await api(`/api/v1/orgs/${orgId}`, { method: 'PUT', body: JSON.stringify(record) })
  }
  console.log(`  POST /api/v1/orgs → ${created.status}`)
  console.log(prettify(created.text))
  if (created.status === 409) {
    note(`org "${orgId}" is taken. Re-run with --update to overwrite it, or set NANDA_ORG_ID to something else.`)
  }
  if (!created.status.toString().startsWith('2')) process.exit(1)

  // -- 4. DNS challenge ----------------------------------------------------
  const ch = await api(`/api/v1/orgs/${orgId}/domain-challenge`, { method: 'POST' })
  console.log(`\n  POST /api/v1/orgs/${orgId}/domain-challenge → ${ch.status}`)
  const challenge = safeJson<{
    domain: string
    record_name: string
    record_type: string
    record_value: string
    expires_at: string
  }>(ch.text)
  if (!challenge) {
    console.log(prettify(ch.text))
    process.exit(1)
  }

  console.log(`
  Add this DNS record at your registrar, then re-run with --verify:

    name   ${challenge.record_name}
    type   ${challenge.record_type}
    value  ${challenge.record_value}
    (expires ${challenge.expires_at})

  check it has propagated:
    dig +short TXT ${challenge.record_name}

  then:
    nanda index-register --verify
`)
}

async function authenticate(email: string, password: string): Promise<string> {
  const post = async (path: string, body: unknown) => {
    const res = await fetch(`${INDEX_API}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    })
    return { status: res.status, text: await res.text() }
  }

  // Register first; an existing account 409s, and then we log in. Doing it this
  // way round means the first run of this command on a fresh machine works.
  const reg = await post('/auth/register', { email, password, display_name: 'sutra' })
  if (reg.status === 201) {
    const t = safeJson<{ token?: string }>(reg.text)?.token
    if (t) return t
  }
  if (reg.status !== 409 && reg.status !== 400) {
    note(`/auth/register → ${reg.status}, falling back to /auth/login`)
  }

  const login = await post('/auth/login', { email, password })
  const token = safeJson<{ token?: string }>(login.text)?.token
  if (!token) {
    // Deliberately does not echo the response body: it can contain the email
    // and, on some servers, part of the submitted credentials.
    throw new Error(`could not authenticate to ${INDEX_API} (register ${reg.status}, login ${login.status})`)
  }
  return token
}

// ---------------------------------------------------------------------------

function safeJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

function prettify(text: string): string {
  const parsed = safeJson<unknown>(text)
  const out = parsed ? JSON.stringify(parsed, null, 2) : text
  return out
    .split('\n')
    .map((l) => `    ${l}`)
    .join('\n')
    .slice(0, 4000)
}

/** Enough to recognise which account you used, not enough to be a leak in a log. */
function redactEmail(email: string): string {
  const [user = '', domain = ''] = email.split('@')
  return `${user.slice(0, 2)}…@${domain}`
}

main().catch((e) => {
  console.error(`\n✗ ${(e as Error).message}\n`)
  process.exit(1)
})
