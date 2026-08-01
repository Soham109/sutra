// Discovery routes: the surfaces that let another agent find this one.
//
// Everything served here is generated, never hand-edited, and every absolute
// URL inside every document is derived from the configured base URL. Point
// APP_BASE_URL at a real host and the whole discovery chain relocates with it.
//
// What is served, and why each one exists:
//
//   GET /.well-known/agent-card.json      A2A AgentCard, at the RFC 8615
//                                         well-known URI the A2A spec registers.
//   GET /.well-known/agents/sutra.json    The same card at the path a NANDA
//                                         AI-Catalog entry conventionally
//                                         points at.
//   GET /.well-known/agent-facts.json     NANDA AgentFacts.
//   GET /agent-facts.json                 The same, at the root path some
//                                         AgentFacts resolvers try first.
//   GET /.well-known/extensions/gmp-1.json  Definition of the A2A capability
//                                         extension the card declares, so the
//                                         extension URI actually dereferences
//                                         instead of 404ing.
//   GET /api/agents                       The AI Catalog. A NANDA index record
//                                         points `registry_url` at <base>/api;
//                                         the resolver appends /agents.
//   GET /skill.md                         The repo-root SKILL.md as
//                                         text/markdown, for the Nanda Town
//                                         SkillMD registry (which probes this
//                                         URL and badges it reachable or not)
//                                         and for OpenClaw-style agents.
//
// NOT served: /.well-known/ai-plugin.json. That manifest belonged to ChatGPT
// plugins, which OpenAI sunset on 2024-04-09; the replacement (GPT Actions)
// consumes an OpenAPI document instead, and this repo already publishes one at
// openapi.json. Serving a dead manifest would be discovery cosplay: a file no
// live client fetches, advertising an integration path that no longer exists.

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { buildAgentCard, buildExtensionDocument } from './agent-card.js'
import { buildAgentFacts } from './agent-facts.js'
import { buildCatalog } from './catalog.js'
import {
  SKILL_MD_DEV_BASE,
  WELL_KNOWN,
  abs,
  normalizeBaseUrl,
  paymentsExtensionUri,
  type DiscoveryConfig,
} from './endpoints.js'

const here = dirname(fileURLToPath(import.meta.url))
/** engine/src/discovery → engine/src → engine → repo root */
const REPO_ROOT = resolve(here, '..', '..', '..')

/**
 * Real deployed A2A cards and NANDA catalogs serve `application/json`, and so
 * does every probe that will fetch these. The expressive media types
 * (`application/a2a+json`, `application/a2a-agent-card+json`) are carried in
 * the catalog's `mediaType` field, where they are data rather than a
 * compatibility risk for a client with a strict JSON check.
 */
const JSON_TYPE = 'application/json; charset=utf-8'
const MARKDOWN_TYPE = 'text/markdown; charset=utf-8'

/** Permissive by design: discovery documents are public, static and unauthenticated. */
function cors(reply: FastifyReply): void {
  reply.header('access-control-allow-origin', '*')
  reply.header('access-control-allow-methods', 'GET, HEAD, OPTIONS')
  reply.header(
    'access-control-allow-headers',
    // A2A v1.0 registers `A2A-Extensions`; v0.3.0 used `X-A2A-Extensions`.
    // Accept both so a client of either vintage can activate our extension.
    'authorization, content-type, a2a-extensions, x-a2a-extensions',
  )
  reply.header('access-control-expose-headers', 'a2a-extensions, x-a2a-extensions')
  reply.header('access-control-max-age', '86400')
}

export function registerDiscoveryRoutes(app: FastifyInstance, cfg: DiscoveryConfig): void {
  // Fail loudly at boot rather than serving documents full of `undefined`.
  normalizeBaseUrl(cfg.baseUrl)
  const extensionUri = paymentsExtensionUri(cfg)
  const skillMdPath = cfg.skillMdPath ?? join(REPO_ROOT, 'SKILL.md')

  const DISCOVERY_PATHS: ReadonlySet<string> = new Set(Object.values(WELL_KNOWN))

  // registerRoutes() installs a global onSend hook that rewrites the CORS
  // headers for every response on this instance, and it does not know about the
  // A2A extension headers. Hooks run in registration order, so re-asserting our
  // headers here — for discovery paths only, and only ever widening them —
  // keeps a browser-side A2A client able to send `A2A-Extensions` on a
  // cross-origin request regardless of which register* function ran first.
  app.addHook('onSend', async (req, reply, payload) => {
    if (DISCOVERY_PATHS.has(req.url.split('?')[0] ?? '')) cors(reply)
    return payload
  })

  const sendJson = (reply: FastifyReply, body: unknown): FastifyReply => {
    cors(reply)
    reply.header('cache-control', 'public, max-age=3600')
    return reply.type(JSON_TYPE).send(JSON.stringify(body, null, 2))
  }

  /**
   * If a client activated our extension, echo it back — that is how an A2A
   * client learns the server understood, and it costs one header.
   */
  const echoExtensions = (req: FastifyRequest, reply: FastifyReply): void => {
    const asked = String(req.headers['a2a-extensions'] ?? req.headers['x-a2a-extensions'] ?? '')
    if (!asked) return
    const active = asked
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s === extensionUri)
    if (active.length === 0) return
    reply.header('a2a-extensions', active.join(', '))
    reply.header('x-a2a-extensions', active.join(', '))
  }

  const options = (path: string): void => {
    app.options(path, async (_req, reply) => {
      cors(reply)
      return reply.status(204).send()
    })
  }

  // -- A2A ------------------------------------------------------------------

  const card = async (req: FastifyRequest, reply: FastifyReply) => {
    echoExtensions(req, reply)
    return sendJson(reply, buildAgentCard(cfg))
  }

  app.get(WELL_KNOWN.agentCard, card)
  app.get(WELL_KNOWN.namedAgentCard, card)
  options(WELL_KNOWN.agentCard)
  options(WELL_KNOWN.namedAgentCard)

  app.get(WELL_KNOWN.paymentsExtension, async (_req, reply) =>
    sendJson(reply, buildExtensionDocument(cfg)),
  )
  options(WELL_KNOWN.paymentsExtension)

  // -- NANDA AgentFacts -----------------------------------------------------

  const facts = async (_req: FastifyRequest, reply: FastifyReply) =>
    sendJson(reply, buildAgentFacts(cfg))

  app.get(WELL_KNOWN.agentFacts, facts)
  app.get(WELL_KNOWN.agentFactsRoot, facts)
  options(WELL_KNOWN.agentFacts)
  options(WELL_KNOWN.agentFactsRoot)

  // -- AI Catalog -----------------------------------------------------------

  app.get(WELL_KNOWN.catalog, async (_req, reply) => sendJson(reply, buildCatalog(cfg)))
  options(WELL_KNOWN.catalog)

  // -- SkillMD --------------------------------------------------------------
  //
  // Read per request rather than cached at boot: the Nanda Town registry probes
  // this URL and badges the listing reachable or unreachable, and the file is a
  // few kilobytes. Serving a stale copy to save a stat is the wrong trade.
  //
  // The repo copy of SKILL.md is written against the dev base
  // (http://localhost:4100) so that every curl in it works for a developer who
  // just cloned this. The SERVED copy rewrites every occurrence to the
  // configured base, so the published SkillMD's `## Base URL` line and all of
  // its example calls point at wherever this engine actually is — and cannot
  // drift, because there is no second place to update.

  const publicBase = abs(cfg, '')

  app.get(WELL_KNOWN.skillMd, async (_req, reply) => {
    cors(reply)
    let md: string
    try {
      md = readFileSync(skillMdPath, 'utf8')
    } catch {
      return reply
        .status(404)
        .type(JSON_TYPE)
        .send(JSON.stringify({ error: 'SKILL.md is not available on this deployment' }))
    }
    reply.header('cache-control', 'public, max-age=300')
    return reply
      .type(MARKDOWN_TYPE)
      .send(publicBase === SKILL_MD_DEV_BASE ? md : md.split(SKILL_MD_DEV_BASE).join(publicBase))
  })
  options(WELL_KNOWN.skillMd)
}
