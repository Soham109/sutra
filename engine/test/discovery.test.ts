import { describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildAgentCard, SKILL_ENDPOINTS } from '../src/discovery/agent-card.js'
import { buildAgentFacts, PAYMENTS_EXTENSION_KEY } from '../src/discovery/agent-facts.js'
import { buildCatalog, buildIndexRecord, CATALOG_SPEC_VERSION } from '../src/discovery/catalog.js'
import { registerDiscoveryRoutes } from '../src/discovery/routes.js'
import {
  ENGINE_ENDPOINTS,
  ENGINE_VERSION,
  WELL_KNOWN,
  abs,
  isLoopback,
  normalizeBaseUrl,
  type DiscoveryConfig,
} from '../src/discovery/endpoints.js'
import { RAILS } from '../src/rails.js'

const here = dirname(fileURLToPath(import.meta.url))
const engineRoot = resolve(here, '..')
const repoRoot = resolve(engineRoot, '..')

const BASE = 'https://sutra.example.test'
const cfg: DiscoveryConfig = { baseUrl: `${BASE}/`, now: '2026-08-01T00:00:00.000Z' }

// ---------------------------------------------------------------------------
// Schema validation against the REAL AgentFacts schema.
//
// engine/test/fixtures/agentfacts_schema.json is a byte-for-byte copy of
// https://raw.githubusercontent.com/projnanda/agentfacts-format/main/agentfacts_schema.json
// fetched 2026-08-01 ($id https://agentfacts.org/schema/v1, draft-07).
//
// ajv is present in this workspace's node_modules but only transitively — it is
// not a declared dependency of @sutra/engine, so it may disappear on any
// dependency change. The test therefore ALWAYS runs a self-contained draft-07
// subset validator (below), and ADDITIONALLY runs ajv when it resolves. Neither
// path is a stand-in for the other: the local validator guarantees the test
// keeps validating, ajv guarantees the local validator is not lying.
// ---------------------------------------------------------------------------

const SCHEMA = JSON.parse(
  readFileSync(join(here, 'fixtures', 'agentfacts_schema.json'), 'utf8'),
) as JsonSchema

interface JsonSchema {
  $schema?: string
  $id?: string
  type?: string | string[]
  required?: string[]
  properties?: Record<string, JsonSchema>
  items?: JsonSchema
  minItems?: number
  maxItems?: number
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
  enum?: unknown[]
  pattern?: string
  format?: string
}

/**
 * A focused JSON Schema draft-07 validator: exactly the keywords this schema
 * uses (type, required, properties, items, minItems/maxItems, min/maxLength,
 * minimum/maximum, enum, pattern, format:uri|date-time|email), walked
 * generically over the schema rather than hand-coded per field. Unknown
 * keywords are ignored, which is draft-07's own rule.
 */
function validate(schema: JsonSchema, value: unknown, path = '$'): string[] {
  const errors: string[] = []
  const typeOf = (v: unknown): string =>
    v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'number' && Number.isInteger(v) ? 'integer' : typeof v

  if (schema.type !== undefined) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type]
    const actual = typeOf(value)
    const ok = allowed.some((t) => t === actual || (t === 'number' && actual === 'integer'))
    if (!ok) {
      errors.push(`${path}: expected type ${allowed.join('|')}, got ${actual}`)
      return errors
    }
  }

  if (schema.enum && !schema.enum.some((e) => e === value)) {
    errors.push(`${path}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`)
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${path}: shorter than minLength ${schema.minLength}`)
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(`${path}: longer than maxLength ${schema.maxLength}`)
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${path}: does not match ${schema.pattern}`)
    }
    if (schema.format === 'uri') {
      // draft-07 `uri` means an absolute URI: a scheme is mandatory.
      let ok = false
      try {
        ok = !!new URL(value).protocol
      } catch {
        ok = false
      }
      if (!ok) errors.push(`${path}: ${JSON.stringify(value)} is not an absolute URI`)
    }
    if (schema.format === 'date-time' && Number.isNaN(Date.parse(value))) {
      errors.push(`${path}: ${JSON.stringify(value)} is not a date-time`)
    }
    if (schema.format === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
      errors.push(`${path}: ${JSON.stringify(value)} is not an email`)
    }
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${path}: below minimum ${schema.minimum}`)
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${path}: above maximum ${schema.maximum}`)
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${path}: fewer than minItems ${schema.minItems}`)
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(`${path}: more than maxItems ${schema.maxItems}`)
    }
    if (schema.items) {
      value.forEach((v, i) => errors.push(...validate(schema.items!, v, `${path}[${i}]`)))
    }
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>
    for (const key of schema.required ?? []) {
      if (!(key in obj)) errors.push(`${path}: missing required property "${key}"`)
    }
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      if (key in obj) errors.push(...validate(sub, obj[key], `${path}.${key}`))
    }
  }

  return errors
}

/** ajv, when it resolves. The string indirection keeps tsc from binding to it. */
async function ajvErrors(doc: unknown): Promise<string[] | null> {
  try {
    const load = (m: string): Promise<any> => import(/* @vite-ignore */ m)
    const [ajvMod, formatsMod] = await Promise.all([load('ajv'), load('ajv-formats')])
    const Ajv = ajvMod.default ?? ajvMod
    const addFormats = formatsMod.default ?? formatsMod
    const ajv = new Ajv({ allErrors: true, strict: false })
    addFormats(ajv)
    const check = ajv.compile(SCHEMA)
    return check(doc) ? [] : (check.errors ?? []).map((e: any) => `${e.instancePath || '$'} ${e.message}`)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------

describe('AgentFacts', () => {
  const facts = buildAgentFacts(cfg)

  it('validates against the vendored real schema (local draft-07 validator)', () => {
    expect(validate(SCHEMA, facts)).toEqual([])
  })

  it('validates against the vendored real schema under ajv, when ajv is resolvable', async () => {
    const errs = await ajvErrors(facts)
    if (errs === null) {
      // ajv is transitive-only; its absence must not fail the suite. The local
      // validator above is the guarantee.
      console.warn('discovery.test: ajv not resolvable — local validator only')
      return
    }
    expect(errs).toEqual([])
  })

  it('carries every field the real schema marks required', () => {
    for (const key of SCHEMA.required ?? []) expect(facts).toHaveProperty(key)
    expect(SCHEMA.$id).toBe('https://agentfacts.org/schema/v1')
    expect(SCHEMA.$schema).toBe('http://json-schema.org/draft-07/schema#')
  })

  it('stays valid with the proposed x-payments extension REMOVED — it is purely additive', () => {
    const bare = buildAgentFacts(cfg, { includePaymentsExtension: false })
    expect(bare).not.toHaveProperty(PAYMENTS_EXTENSION_KEY)
    expect(validate(SCHEMA, bare)).toEqual([])
  })

  it('marks x-payments unmistakably as a proposal, not spec', () => {
    const ext = facts[PAYMENTS_EXTENSION_KEY]!
    expect(PAYMENTS_EXTENSION_KEY.startsWith('x-')).toBe(true)
    expect(ext.status).toBe('proposed-extension')
    expect(ext.$comment).toMatch(/NOT part of the AgentFacts v1 schema/i)
    // The base schema genuinely has no payment vocabulary — that is the whole
    // reason this block exists, so assert it rather than assuming it.
    const props = Object.keys(SCHEMA.properties ?? {})
    for (const word of ['pay', 'money', 'custod', 'settle', 'financ', 'card']) {
      expect(props.some((p) => p.toLowerCase().includes(word))).toBe(false)
    }
  })

  it('describes the settlement model truthfully, from rails.ts', () => {
    const ext = facts[PAYMENTS_EXTENSION_KEY]!
    expect(ext.multi_principal).toBe(true)
    expect(ext.custody.pools_funds).toBe(false)
    expect(ext.custody.holds_funds).toBe(false)
    expect(ext.custody.sees_card_numbers).toBe(false)
    expect(ext.consent.agent_may_approve_on_behalf).toBe(false)
    expect(ext.rails.map((r) => r.rail).sort()).toEqual(Object.keys(RAILS).sort())
    for (const r of ext.rails) {
      const real = RAILS[r.rail as keyof typeof RAILS]
      expect(r.charges).toBe(real.charges)
      expect(r.mandates).toBe(real.mandates)
      expect(r.disclosure).toBe(real.disclosure)
    }
  })
})

// ---------------------------------------------------------------------------

describe('URLs', () => {
  /** Every string anywhere in a document that looks like an http(s) URL. */
  const urlsIn = (doc: unknown): string[] => {
    const out: string[] = []
    const walk = (v: unknown): void => {
      if (typeof v === 'string') {
        if (/^https?:\/\//i.test(v)) out.push(v)
        return
      }
      if (Array.isArray(v)) return void v.forEach(walk)
      if (v && typeof v === 'object') return void Object.values(v).forEach(walk)
    }
    walk(doc)
    return out
  }

  const documents = {
    'agent card': buildAgentCard(cfg),
    'agent facts': buildAgentFacts(cfg),
    catalog: buildCatalog(cfg),
    'index record': buildIndexRecord(cfg, { contactEmail: 'team@sutra.example.test' }),
  }

  /**
   * The only URLs allowed to point off-host: identifiers for specifications we
   * conform to. They name a schema, they are not a place we serve anything.
   */
  const EXTERNAL_ALLOWED = new Set(['https://agentfacts.org/schema/v1'])

  for (const [name, doc] of Object.entries(documents)) {
    it(`${name}: every URL is absolute and rooted at the configured base`, () => {
      const urls = urlsIn(doc).filter((u) => !EXTERNAL_ALLOWED.has(u))
      expect(urls.length).toBeGreaterThan(0)
      for (const u of urls) {
        expect(() => new URL(u)).not.toThrow()
        expect(u.startsWith(`${BASE}/`) || u === BASE, u).toBe(true)
      }
    })
  }

  it('relocates wholesale when the base changes — nothing is hardcoded', () => {
    const other = 'https://gmp.somewhere-else.test'
    const card = buildAgentCard({ ...cfg, baseUrl: other })
    for (const u of urlsIn(card)) {
      if (EXTERNAL_ALLOWED.has(u)) continue
      expect(u.startsWith(other), u).toBe(true)
    }
    expect(urlsIn(card).some((u) => u.includes('sutra.example.test'))).toBe(false)
  })

  it('normalizes the base URL and rejects nonsense', () => {
    expect(normalizeBaseUrl('https://x.test/')).toBe('https://x.test')
    expect(normalizeBaseUrl('https://x.test///')).toBe('https://x.test')
    expect(normalizeBaseUrl('https://x.test/engine/')).toBe('https://x.test/engine')
    expect(() => normalizeBaseUrl('')).toThrow(/required/)
    expect(() => normalizeBaseUrl('sutra.example')).toThrow(/absolute/)
    expect(() => normalizeBaseUrl('ftp://x.test')).toThrow(/http/)
  })

  it('knows a URL a registry prober could never reach', () => {
    for (const u of [
      'http://localhost:4100',
      'http://127.0.0.1:4100',
      'http://0.0.0.0:4100',
      'http://192.168.1.9:4100',
      'http://10.0.0.4',
      'http://172.16.0.2',
    ]) {
      expect(isLoopback(u)).toBe(true)
    }
    expect(isLoopback('https://sutra.example.test')).toBe(false)
    expect(isLoopback('https://gmp.onrender.com')).toBe(false)
  })
})

// ---------------------------------------------------------------------------

describe('the A2A card against the real route list', () => {
  /**
   * Every `.ts` file under engine/src, walked recursively — NOT a hand-kept
   * list of "the route files". A hand-kept list is exactly what let the
   * delegate surface (delegate/routes.ts: /v1/delegate/rules,
   * /v1/plans/:planId/questions, /v1/participants/:id/delegate-answer — the
   * very endpoints mcp/src/server.ts's delegate tools call) register real,
   * callable routes with zero representation in ENGINE_ENDPOINTS: the
   * original version of this test only read routes.ts / routes-v2.ts /
   * routes-plan.ts, so a fourth route file was invisible to it and nobody
   * found out until this comment was written. Walking the directory means a
   * future fifth route file cannot repeat that silently.
   */
  const allTsFiles = (dir: string): string[] => {
    const out: string[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) out.push(...allTsFiles(full))
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(full)
    }
    return out
  }

  const routeFiles = allTsFiles(join(engineRoot, 'src'))

  const registered = (() => {
    const found = new Set<string>()
    for (const file of routeFiles) {
      const src = readFileSync(file, 'utf8')
      for (const m of src.matchAll(/app\.(get|post|put|delete)\(\s*'([^']+)'/g)) {
        found.add(`${m[1]!.toUpperCase()} ${m[2]!}`)
      }
    }
    return found
  })()

  it('walked every route-registering file, not just the ones ENGINE_ENDPOINTS already knows about', () => {
    // A regression guard on the walk itself: these are real routes that live
    // outside routes.ts/routes-v2.ts/routes-plan.ts. If this ever goes red,
    // the walk broke, not the routes.
    expect(registered.has('GET /v1/plans/:planId/questions')).toBe(true)
    expect(registered.has('POST /v1/participants/:id/delegate-answer')).toBe(true)
    expect(registered.has('PUT /v1/delegate/rules')).toBe(true)
    expect(registered.has('GET /health')).toBe(true)
  })

  it('parsed a plausible route table', () => {
    expect(registered.size).toBeGreaterThan(20)
    expect(registered.has('POST /v1/groups')).toBe(true)
  })

  it('advertises only endpoints the engine actually registers', () => {
    const missing = ENGINE_ENDPOINTS.map((e) => `${e.method} ${e.path}`).filter(
      (k) => !registered.has(k),
    )
    expect(missing).toEqual([])
  })

  it('every skill is backed by endpoints from that same inventory', () => {
    const inventory = new Set(ENGINE_ENDPOINTS.map((e) => `${e.method} ${e.path}`))
    for (const [skill, eps] of Object.entries(SKILL_ENDPOINTS)) {
      expect(eps.length, `${skill} has no endpoints`).toBeGreaterThan(0)
      for (const ep of eps) expect(inventory.has(ep), `${skill} → ${ep}`).toBe(true)
    }
  })

  it('the card declares a skill for every advertised skill group, and nothing invented', () => {
    const card = buildAgentCard(cfg)
    expect(card.skills.map((s) => s.id).sort()).toEqual(Object.keys(SKILL_ENDPOINTS).sort())
    for (const s of card.skills) {
      expect(s.name.length).toBeGreaterThan(0)
      expect(s.description.length).toBeGreaterThan(40)
      expect(s.tags.length).toBeGreaterThan(0)
      expect(s.examples.length).toBeGreaterThan(0)
    }
  })

  it('names the five capabilities the brief asks us to expose', () => {
    for (const id of [
      'create_group_checkout',
      'coordinate_group_plan',
      'split_a_bill',
      'watch_a_group',
      'verify_group_receipt',
    ]) {
      expect(Object.keys(SKILL_ENDPOINTS)).toContain(id)
    }
  })

  it('carries the GMP/1 capability extension at a dereferenceable URI', () => {
    const card = buildAgentCard(cfg)
    const ext = card.capabilities.extensions[0]!
    expect(ext.uri).toBe(abs(cfg, WELL_KNOWN.paymentsExtension))
    expect(ext.required).toBe(false)
    // Both header spellings, because A2A renamed it between v0.3.0 and v1.0.
    expect(ext.description).toMatch(/A2A-Extensions/)
    expect(ext.description).toMatch(/X-A2A-Extensions/)
    const api = (ext.params as { api: { endpoints: { path: string }[] } }).api
    expect(api.endpoints.length).toBe(ENGINE_ENDPOINTS.length)
  })

  it('does not claim an A2A method surface it has not implemented', () => {
    const card = buildAgentCard(cfg)
    expect(card.description).toMatch(/does not implement the A2A canonical method set/i)
    // Deliberately NOT 'HTTP+JSON': that names one of A2A's three core
    // bindings and implies the canonical method surface mapped onto REST
    // (POST {url}/message:send etc — this engine 404s that, confirmed live).
    // protocolBinding is spec'd as an open string precisely so an
    // implementation can say "REST, but not THAT REST" without lying.
    expect(card.preferredTransport).toBe('sutra-rest-v1')
    // v0.3 shape and v1.0 shape both present, describing the same interface.
    expect(card.additionalInterfaces).toEqual(card.supportedInterfaces)
    expect(card.supportedInterfaces[0]!.protocolBinding).toBe('sutra-rest-v1')
    expect(card.supportedInterfaces[0]!.protocolBinding).not.toBe('HTTP+JSON')
  })
})

// ---------------------------------------------------------------------------

describe('AI Catalog and NANDA index record', () => {
  const catalog = buildCatalog(cfg)

  it('matches the live catalog wire shape', () => {
    expect(catalog.specVersion).toBe(CATALOG_SPEC_VERSION)
    expect(typeof catalog.specVersion).toBe('string')
    expect(catalog.entries.length).toBeGreaterThan(0)
    for (const e of catalog.entries) {
      for (const k of [
        'identifier',
        'displayName',
        'mediaType',
        'url',
        'description',
        'tags',
        'version',
        'updatedAt',
        'metadata',
      ]) {
        expect(e).toHaveProperty(k)
      }
      expect(new Date(e.updatedAt).toString()).not.toBe('Invalid Date')
    }
  })

  it('points its primary entry at our own well-known card URL', () => {
    const primary = catalog.entries[0]!
    expect(primary.url).toBe(abs(cfg, WELL_KNOWN.namedAgentCard))
    expect(primary.mediaType).toBe('application/a2a-agent-card+json')
  })

  it('index record points registry_url at the catalog parent, so /agents resolves', () => {
    const rec = buildIndexRecord(cfg, { contactEmail: 'team@sutra.example.test' })
    expect(rec.registry_url).toBe(`${BASE}/api`)
    expect(`${rec.registry_url}/agents`).toBe(abs(cfg, WELL_KNOWN.catalog))
    expect(rec.media_type).toBe('application/ai-catalog+json')
    expect(rec.identifier).toBe('urn:ai:domain:sutra.example.test')
    // Constraints read off the live OpenAPI document.
    expect(rec.org_id).toMatch(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/)
    expect(rec.ttl_seconds).toBeGreaterThanOrEqual(3600)
    expect(rec.ttl_seconds).toBeLessThanOrEqual(604800)
    expect(rec.tags.length).toBeLessThanOrEqual(20)
    expect(['registry', 'dns-aid', 'smb', 'personal']).toContain(rec.hosting_path)
  })

  it('rejects an org_id the index would reject', () => {
    expect(() => buildIndexRecord(cfg, { contactEmail: 'a@b.test', orgId: 'Sutra' })).toThrow()
    expect(() => buildIndexRecord(cfg, { contactEmail: 'a@b.test', orgId: '-sutra' })).toThrow()
    expect(() => buildIndexRecord(cfg, { contactEmail: 'a@b.test', orgId: 's' })).toThrow()
  })
})

// ---------------------------------------------------------------------------

describe('served routes', () => {
  const build = async () => {
    const app = Fastify()
    registerDiscoveryRoutes(app, { ...cfg, skillMdPath: join(repoRoot, 'SKILL.md') })
    await app.ready()
    return app
  }

  const jsonRoutes = [
    WELL_KNOWN.agentCard,
    WELL_KNOWN.namedAgentCard,
    WELL_KNOWN.agentFacts,
    WELL_KNOWN.agentFactsRoot,
    WELL_KNOWN.paymentsExtension,
    WELL_KNOWN.catalog,
  ]

  it('serves every JSON document with a JSON content type and permissive CORS', async () => {
    const app = await build()
    try {
      for (const path of jsonRoutes) {
        const res = await app.inject({ method: 'GET', url: path })
        expect(res.statusCode, path).toBe(200)
        expect(res.headers['content-type'], path).toMatch(/^application\/json/)
        expect(res.headers['access-control-allow-origin'], path).toBe('*')
        expect(() => JSON.parse(res.body), path).not.toThrow()
      }
    } finally {
      await app.close()
    }
  })

  it('serves the same card at both card paths', async () => {
    const app = await build()
    try {
      const a = await app.inject({ method: 'GET', url: WELL_KNOWN.agentCard })
      const b = await app.inject({ method: 'GET', url: WELL_KNOWN.namedAgentCard })
      expect(JSON.parse(a.body)).toEqual(JSON.parse(b.body))
      expect(JSON.parse(a.body)).toEqual(buildAgentCard(cfg))
    } finally {
      await app.close()
    }
  })

  it('serves SKILL.md as text/markdown in the NandaHack shape', async () => {
    const app = await build()
    try {
      const res = await app.inject({ method: 'GET', url: WELL_KNOWN.skillMd })
      expect(res.statusCode).toBe(200)
      expect(res.headers['content-type']).toMatch(/^text\/markdown/)
      const lines = res.body.split(/\r?\n/)
      // `# Title`, blank, one-line description — and no YAML frontmatter.
      expect(lines[0]!.startsWith('# ')).toBe(true)
      expect(lines[0]!.startsWith('---')).toBe(false)
      expect(lines[1]).toBe('')
      expect(lines[2]!.length).toBeGreaterThan(10)
      // `## Base URL` followed by a bare URL on its own line.
      const baseIdx = lines.indexOf('## Base URL')
      expect(baseIdx).toBeGreaterThan(0)
      expect(lines[baseIdx + 1]).toBe(BASE)
      expect(lines).toContain('## Endpoints')
      expect(lines).toContain('## How the agent should use this')
      // Numbered steps, starting at 1.
      const stepIdx = lines.indexOf('## How the agent should use this')
      expect(lines[stepIdx + 1]!.startsWith('1. ')).toBe(true)
    } finally {
      await app.close()
    }
  })

  it('rewrites every dev-base URL in the served SkillMD, not just the Base URL line', async () => {
    const app = await build()
    try {
      const res = await app.inject({ method: 'GET', url: WELL_KNOWN.skillMd })
      expect(res.body).not.toContain('localhost')
      expect(res.body).toContain(`curl "${BASE}/v1/`)
      // The repo copy is deliberately the dev default, so a fresh clone works.
      expect(readFileSync(join(repoRoot, 'SKILL.md'), 'utf8')).toContain('http://localhost:4100')
    } finally {
      await app.close()
    }
  })

  it('every endpoint SKILL.md documents is one the engine registers', () => {
    const md = readFileSync(join(repoRoot, 'SKILL.md'), 'utf8')
    // Endpoint headers sit at column 0 as `METHOD /path`.
    const documented = [...md.matchAll(/^(GET|POST|PUT|DELETE) (\/\S*)$/gm)].map((m) => ({
      method: m[1]!,
      path: m[2]!,
    }))
    expect(documented.length).toBeGreaterThan(8)
    /** `/v1/groups/{group_id}` and `/v1/groups/:id` are the same route. */
    const shape = (method: string, path: string): string =>
      `${method} ${path.split('?')[0]!.replace(/\{[^}]+\}/g, ':p').replace(/:[A-Za-z_]+/g, ':p')}`
    const inventory = new Set(ENGINE_ENDPOINTS.map((e) => shape(e.method, e.path)))
    for (const d of documented) {
      expect(inventory.has(shape(d.method, d.path)), `${d.method} ${d.path}`).toBe(true)
    }
  })

  // The other direction. SKILL.md is hand-written prose, not generated from
  // ENGINE_ENDPOINTS the way the JSON documents (agent card, AgentFacts,
  // catalog) are — this is the closest a hand-written document can get to
  // "cannot drift from the API" without an actual generator: it goes red the
  // moment ENGINE_ENDPOINTS grows a route this file forgot to prose-document,
  // the exact way the delegate endpoints (PUT/GET /v1/delegate/rules,
  // GET /v1/plans/:planId/questions, POST /v1/participants/:id/delegate-answer)
  // and GET /health went undocumented here for as long as they did.
  it('every endpoint in ENGINE_ENDPOINTS is documented in SKILL.md — the reverse direction', () => {
    const md = readFileSync(join(repoRoot, 'SKILL.md'), 'utf8')
    const documented = [...md.matchAll(/^(GET|POST|PUT|DELETE) (\/\S*)$/gm)].map((m) => ({
      method: m[1]!,
      path: m[2]!,
    }))
    const shape = (method: string, path: string): string =>
      `${method} ${path.split('?')[0]!.replace(/\{[^}]+\}/g, ':p').replace(/:[A-Za-z_]+/g, ':p')}`
    const documentedShapes = new Set(documented.map((d) => shape(d.method, d.path)))
    const undocumented = ENGINE_ENDPOINTS.map((e) => shape(e.method, e.path)).filter(
      (s) => !documentedShapes.has(s),
    )
    expect(undocumented).toEqual([])
  })

  it('404s the SkillMD honestly rather than serving something else', async () => {
    const app = Fastify()
    registerDiscoveryRoutes(app, { ...cfg, skillMdPath: join(repoRoot, 'no-such-file.md') })
    await app.ready()
    try {
      const res = await app.inject({ method: 'GET', url: WELL_KNOWN.skillMd })
      expect(res.statusCode).toBe(404)
    } finally {
      await app.close()
    }
  })

  it('answers CORS preflight on every discovery path', async () => {
    const app = await build()
    try {
      for (const path of [...jsonRoutes, WELL_KNOWN.skillMd]) {
        const res = await app.inject({ method: 'OPTIONS', url: path })
        expect(res.statusCode, path).toBe(204)
        expect(res.headers['access-control-allow-origin'], path).toBe('*')
      }
    } finally {
      await app.close()
    }
  })

  it('echoes an activated A2A extension back under both header spellings', async () => {
    const app = await build()
    try {
      const uri = abs(cfg, WELL_KNOWN.paymentsExtension)
      for (const header of ['a2a-extensions', 'x-a2a-extensions']) {
        const res = await app.inject({
          method: 'GET',
          url: WELL_KNOWN.agentCard,
          headers: { [header]: uri },
        })
        expect(res.headers['a2a-extensions'], header).toBe(uri)
        expect(res.headers['x-a2a-extensions'], header).toBe(uri)
      }
      const none = await app.inject({ method: 'GET', url: WELL_KNOWN.agentCard })
      expect(none.headers['a2a-extensions']).toBeUndefined()
    } finally {
      await app.close()
    }
  })

  it('does not serve the dead ChatGPT-plugin manifest', async () => {
    const app = await build()
    try {
      const res = await app.inject({ method: 'GET', url: '/.well-known/ai-plugin.json' })
      expect(res.statusCode).toBe(404)
    } finally {
      await app.close()
    }
  })

  // registerRoutes() (engine/src/routes.ts) installs a global `onSend` hook
  // that rewrites CORS headers for every response, and an `OPTIONS /*`
  // catch-all. This reproduces both without standing up a GroupService, because
  // the failure mode — a route conflict at boot, or our A2A extension headers
  // being silently narrowed away — would only show up once wired into
  // server.ts.
  it('coexists with the engine’s own global CORS hook and OPTIONS catch-all', async () => {
    const app = Fastify()
    app.addHook('onSend', async (_req, reply, payload) => {
      reply.header('access-control-allow-origin', '*')
      reply.header('access-control-allow-headers', 'authorization, content-type')
      reply.header('access-control-allow-methods', 'GET, POST, OPTIONS')
      return payload
    })
    app.options('/*', async (_req, reply) => reply.status(204).send())

    expect(() => registerDiscoveryRoutes(app, cfg)).not.toThrow()
    await app.ready()
    try {
      const res = await app.inject({ method: 'GET', url: WELL_KNOWN.agentCard })
      expect(res.statusCode).toBe(200)
      expect(res.headers['access-control-allow-headers']).toContain('a2a-extensions')
      const pre = await app.inject({ method: 'OPTIONS', url: WELL_KNOWN.catalog })
      expect(pre.statusCode).toBe(204)
    } finally {
      await app.close()
    }
  })

  it('refuses to boot with a base URL it cannot build absolute links from', async () => {
    const app = Fastify()
    expect(() => registerDiscoveryRoutes(app, { baseUrl: 'not-a-url' })).toThrow(/absolute/)
    await app.close()
  })
})

// ---------------------------------------------------------------------------

describe('version', () => {
  it('the advertised version is the package version', () => {
    const pkg = JSON.parse(readFileSync(join(engineRoot, 'package.json'), 'utf8')) as {
      version: string
    }
    expect(ENGINE_VERSION).toBe(pkg.version)
    expect(buildAgentCard(cfg).version).toBe(pkg.version)
    expect(buildAgentFacts(cfg).version).toBe(pkg.version)
  })
})
