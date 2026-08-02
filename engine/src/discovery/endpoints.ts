// The one place that knows what this engine actually serves.
//
// Every discovery document in this directory — the A2A AgentCard, the NANDA
// AgentFacts record, the AI Catalog, the SkillMD served at /skill.md — is
// generated from the inventory below rather than hand-maintained. That is the
// whole point: a discovery document that drifts from the API is worse than no
// discovery document, because an agent will believe it.
//
// Nothing in this file may hardcode a host. Every absolute URL is derived from
// the configured public base URL (APP_BASE_URL) via `abs()`.

/** Engine version. Must track `engine/package.json`; discovery.test.ts asserts it. */
export const ENGINE_VERSION = '0.1.0'

/** The protocol this engine implements, as it appears in receipts and specs. */
export const PROTOCOL = 'GMP/1'

export interface DiscoveryConfig {
  /**
   * Public origin this engine is reachable at, e.g. `https://sutra.example`.
   * Comes from APP_BASE_URL. Never defaulted to a hostname here — a discovery
   * document that advertises someone else's host is a bug, not a fallback.
   */
  baseUrl: string
  /** Override the engine version advertised. Defaults to ENGINE_VERSION. */
  version?: string
  /** Absolute path to the repo-root SKILL.md. Defaults to <repo>/SKILL.md. */
  skillMdPath?: string
  /** ISO timestamp used for `updatedAt` fields. Defaults to now. Injectable so tests are deterministic. */
  now?: string
}

export type HttpMethod = 'GET' | 'POST' | 'PUT'

/** How a caller authenticates to an endpoint. */
export type EndpointAuth =
  /** `Authorization: Bearer <ENGINE_API_TOKEN>` */
  | 'bearer'
  /** open — anyone holding the (unguessable) id may read/act */
  | 'none'
  /** needs a signed-in principal (cookie `sutra_uid` or header `x-sutra-user`) */
  | 'session'
  /**
   * Needs to be the resource's own organiser: a signed-in principal whose
   * session created it, OR the engine's bearer token standing in for one
   * (server-to-server callers). See `requirePlanOrganiser` in
   * routes-plan.ts. Distinct from plain `'session'` because holding a
   * session that is NOT the organiser's still gets refused — this is not
   * "any logged-in user", it is "the one who started this".
   */
  | 'session-organiser'

export interface ApiEndpoint {
  method: HttpMethod
  /** Path exactly as registered with Fastify, e.g. `/v1/groups/:id`. */
  path: string
  /** One line, written for a machine reader. */
  summary: string
  auth: EndpointAuth
  /** `text/event-stream` rather than JSON. */
  streaming?: boolean
}

/**
 * The endpoints this engine exposes to other agents.
 *
 * Deliberately a subset of everything Fastify has registered: the social graph
 * (`/v1/people`, `/v1/circles`), the mock Prava ceremony and the HTML surfaces
 * are product/browser concerns, not an agent-to-agent contract. Advertising
 * them would invite agents to call things that only make sense with a human
 * and a cookie behind them.
 *
 * discovery.test.ts asserts that every path here is genuinely registered in
 * engine/src/routes*.ts.
 */
export const ENGINE_ENDPOINTS: readonly ApiEndpoint[] = [
  // -- group checkout (the frozen GMP/1 contract) ---------------------------
  {
    method: 'POST',
    path: '/v1/groups',
    summary:
      'Create a group decision: one cart, N members and a commit policy on an explicit rail. Generic merchant URLs default to checkout handoff; only a trusted operator or configured test-store adapter may select Prava mandates.',
    auth: 'bearer',
  },
  {
    method: 'GET',
    path: '/v1/groups/:id',
    summary: 'Full group state: status, policy, per-member share, cap, and settlement status.',
    auth: 'none',
  },
  {
    method: 'GET',
    path: '/v1/groups/:id/events',
    summary: 'Server-sent event stream of the group timeline from a cursor. The way to watch without polling.',
    auth: 'none',
    streaming: true,
  },
  {
    method: 'POST',
    path: '/v1/groups/:id/cancel',
    summary:
      'Cancel the whole group before commit. Every outstanding mandate is cancelled; nobody is charged. Gated: needs the engine bearer token, a session that created the group, OR — for a group with no account behind it — proof of being the first member via `{"as_member": "<their member_id>"}`. Anyone else gets 403 "only the person who started this group can call it off". Verified live: an anonymous, unauthenticated call 403s.',
    auth: 'session-organiser',
  },
  {
    method: 'GET',
    path: '/v1/groups/:id/receipt',
    summary:
      'The hash-chained, Ed25519-signed consent receipt. Verifiable offline against the public key it carries.',
    auth: 'none',
  },
  {
    method: 'GET',
    path: '/v1/groups/:id/joinable',
    summary: 'Public join view of a group: which member seats are still claimable, for a shared link or NFC totem.',
    auth: 'none',
  },
  {
    method: 'GET',
    path: '/v1/members/:id',
    summary: "One member's own view: their share, their cap, and their Prava approval URL.",
    auth: 'none',
  },
  {
    method: 'POST',
    path: '/v1/members/:id/decline',
    summary: 'Decline on behalf of a member who has told you no. Under all_of this aborts the group.',
    auth: 'none',
  },
  {
    method: 'POST',
    path: '/v1/members/:id/hold',
    summary: "Pause a member's mandate. Held shares count as not-approved when the policy is evaluated.",
    auth: 'none',
  },
  {
    method: 'POST',
    path: '/v1/members/:id/resume',
    summary: 'Resume a held member.',
    auth: 'none',
  },
  {
    method: 'POST',
    path: '/v1/members/:id/bid',
    summary:
      'Place a sealed priority bid on a contested item. Bids allocate slots; they never change what anyone pays.',
    auth: 'none',
  },

  // -- coordination (before a cart exists) ----------------------------------
  {
    method: 'POST',
    path: '/v1/agent/plan',
    summary:
      'One sentence in, a coordinated plan out: extracts intent, geocodes the place, asks the group for availability and location, and ranks real venues from OpenStreetMap.',
    auth: 'none',
  },
  {
    method: 'POST',
    path: '/v1/plans',
    summary: 'Create a coordination plan explicitly, with your own slots, participants and asks.',
    auth: 'none',
  },
  {
    method: 'GET',
    path: '/v1/plans/:id',
    summary: 'Plan state: who has answered, what is still being asked, and the current option list.',
    auth: 'none',
  },
  {
    method: 'GET',
    path: '/v1/plans/:id/events',
    summary: 'Server-sent event stream of the plan timeline.',
    auth: 'none',
    streaming: true,
  },
  {
    method: 'GET',
    path: '/v1/participants/:id',
    summary:
      "One participant's own view: their name, what the plan still wants from them, their own answers so far, and the plan as they are entitled to see it. The id itself is the credential — the same unguessable link that got them here.",
    auth: 'none',
  },
  {
    method: 'POST',
    path: '/v1/participants/:id/signal',
    summary:
      "Record one participant's answer — rsvp, availability window, location, budget ceiling. Answers stay private; only the ranking is shared.",
    auth: 'none',
  },
  {
    method: 'GET',
    path: '/v1/plans/:id/options',
    summary: 'Ranked real options with the best shared time windows, scored on the evidence collected so far.',
    auth: 'none',
  },
  {
    method: 'POST',
    path: '/v1/plans/:id/choose',
    summary:
      'Lock one option as the group choice. Only the plan’s own organiser may call this — the signed-in principal who created it, or the engine bearer token standing in for one. Anyone else gets 403.',
    auth: 'session-organiser',
  },
  {
    method: 'POST',
    path: '/v1/plans/:id/convert',
    summary:
      'The handover: turn a chosen priced option into a GMP/1 group on an explicit POS or checkout-handoff rail. Venue plans stay plans until a real bill exists. Only the plan organiser may call this.',
    auth: 'session-organiser',
  },

  // -- coordination delegates (standing rules; MCP's delegate tools) -------
  //
  // AP2, ACP, Visa IC and Prava itself all assume one principal granting one
  // mandate. These four endpoints are the primitive for the phase before
  // that: a human sets standing rules in advance (a budget ceiling, recurring
  // availability, home location, constraints), and any MCP-capable agent can
  // then answer coordination questions on their behalf using those rules —
  // never a payment. See mcp/src/server.ts (list_open_questions,
  // answer_as_delegate, get_plan_status) and docs/AGENT-MESH.md.
  {
    method: 'PUT',
    path: '/v1/delegate/rules',
    summary:
      "Set the standing rules a delegate agent may act on for the signed-in caller: budget ceiling, recurring availability, home location, constraints. Requires being signed in as the human whose rules these are — nobody else may write another person's rules.",
    auth: 'session',
  },
  {
    method: 'GET',
    path: '/v1/delegate/rules',
    summary: "Read the signed-in caller's own standing rules, or null if none are on file.",
    auth: 'session',
  },
  {
    method: 'GET',
    path: '/v1/plans/:planId/questions',
    summary:
      'What one plan participant still needs to answer before the group can rank real options — rsvp, availability, location, budget, constraints. Call before delegate-answer so a delegate knows what is actually being asked. Never exposes anything about money changing hands.',
    auth: 'none',
  },
  {
    method: 'POST',
    path: '/v1/participants/:id/delegate-answer',
    summary:
      "Apply a human's standing rules and submit whatever those rules actually cover as ordinary coordination signals (rsvp / availability / location / budget / constraint). Anything the rules never anticipated comes back in `skipped` with a plain-English reason, never guessed at. Can never approve a payment or move money — there is no route this can call into that does.",
    auth: 'none',
  },

  // -- bill splitting (the at_venue rail) -----------------------------------
  {
    method: 'POST',
    path: '/v1/bill/parse',
    summary:
      'Parse a restaurant bill from text (or a photo, if the engine has a vision key) into itemised lines that reconcile against the printed total.',
    auth: 'none',
  },
  {
    method: 'POST',
    path: '/v1/bill/split',
    summary:
      'Turn a parsed bill plus who-claimed-what into a group on the at_venue rail: exact per-person amounts, explicit acceptance, signed record — and no card charged through this engine. Needs a signed-in caller (routes-v2.ts throws 401 "sign in to continue" otherwise) — verified live. POST /v1/bill/parse just above needs no auth; only this second step, the one that actually creates a group, does.',
    auth: 'session',
  },

  // -- discovery of things to buy -------------------------------------------
  {
    method: 'GET',
    path: '/v1/discover/search',
    summary: 'Search real merchant catalogs for a buyable product, or resolve a pasted product URL.',
    auth: 'none',
  },
  {
    method: 'POST',
    path: '/v1/discover/resolve',
    summary: 'Resolve one product URL into a structured, priced cart line.',
    auth: 'none',
  },

  // -- trust anchor -----------------------------------------------------------
  {
    method: 'GET',
    path: '/health',
    summary:
      'Liveness, the Prava adapter this deployment is wired to, and — the field that matters for trust — receipt_public_key: the hex Ed25519 public key every consent receipt is signed with right now. This is the independent source a verifier pins a receipt’s embedded public_key against; without fetching this separately, verifying a receipt only proves internal consistency, not that the key is really this engine’s.',
    auth: 'none',
  },
] as const

// ---------------------------------------------------------------------------
// URL construction. Everything absolute, everything derived from baseUrl.
// ---------------------------------------------------------------------------

/** Normalise a configured base URL: absolute http(s), no trailing slash. */
export function normalizeBaseUrl(raw: string): string {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) throw new Error('discovery: APP_BASE_URL is required to build discovery documents')
  let u: URL
  try {
    u = new URL(trimmed)
  } catch {
    throw new Error(`discovery: APP_BASE_URL must be an absolute URL, got ${JSON.stringify(raw)}`)
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`discovery: APP_BASE_URL must be http(s), got ${u.protocol}`)
  }
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}`
}

/**
 * Absolute URL for a path, always rooted at the configured base.
 * `abs(cfg, '')` is the base itself, with no trailing slash — so it can be used
 * as a prefix for string substitution as well as a link.
 */
export function abs(cfg: DiscoveryConfig, path: string): string {
  const base = normalizeBaseUrl(cfg.baseUrl)
  if (!path) return base
  return `${base}${path.startsWith('/') ? path : `/${path}`}`
}

/** Is this base URL only reachable from the machine it runs on? */
export function isLoopback(baseUrl: string): boolean {
  let host: string
  try {
    host = new URL(baseUrl).hostname.toLowerCase()
  } catch {
    return false
  }
  return (
    host === 'localhost' ||
    host === '::1' ||
    host === '0.0.0.0' ||
    host.endsWith('.localhost') ||
    /^127\./.test(host) ||
    // RFC1918 / link-local — reachable on a LAN, not from a registry's prober.
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host)
  )
}

// ---------------------------------------------------------------------------
// Well-known paths. Named once so the routes, the documents and the CLI's
// reachability check can never disagree about where anything lives.
// ---------------------------------------------------------------------------

export const WELL_KNOWN = {
  /** A2A AgentCard, RFC 8615 well-known URI registered by the A2A spec. */
  agentCard: '/.well-known/agent-card.json',
  /** The same card at the path a NANDA AI-Catalog entry conventionally points to. */
  namedAgentCard: '/.well-known/agents/sutra.json',
  /** NANDA AgentFacts. Served at both the well-known and root paths in the wild. */
  agentFacts: '/.well-known/agent-facts.json',
  agentFactsRoot: '/agent-facts.json',
  /** Definition of the non-standard payments extension the card declares. */
  paymentsExtension: '/.well-known/extensions/gmp-1.json',
  /** AI Catalog. NANDA index records point their `registry_url` at the parent of this. */
  catalog: '/api/agents',
  /** The SkillMD, served as text/markdown for the Nanda Town registry and OpenClaw agents. */
  skillMd: '/skill.md',
  /** Liveness + the trust anchor: `receipt_public_key`, the key to pin a receipt's signature to. */
  health: '/health',
} as const

/** The URI that identifies our A2A capability extension. Dereferenceable. */
export function paymentsExtensionUri(cfg: DiscoveryConfig): string {
  return abs(cfg, WELL_KNOWN.paymentsExtension)
}

/** Stable slug for this agent inside a catalog. */
export const AGENT_SLUG = 'sutra'

/**
 * The base URL written into the repo copy of SKILL.md — the dev default, so a
 * developer reading the file in the repo can paste any curl in it and have it
 * work. The copy served at /skill.md rewrites every occurrence of this to the
 * configured APP_BASE_URL, which is what makes the published SkillMD's base URL
 * and its example curls incapable of drifting from where the engine actually
 * is. See registerDiscoveryRoutes.
 */
export const SKILL_MD_DEV_BASE = 'http://localhost:4100'

/** `urn:ai:domain:<host>` — the identifier convention NANDA index records use. */
export function domainUrn(cfg: DiscoveryConfig): string {
  return `urn:ai:domain:${new URL(normalizeBaseUrl(cfg.baseUrl)).hostname}`
}
