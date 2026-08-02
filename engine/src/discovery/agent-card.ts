// The A2A AgentCard for this engine.
//
// Verified against the live A2A specification on 2026-08-01:
//
//   - The card is served at `/.well-known/agent-card.json` (an RFC 8615
//     well-known URI, registered by A2A). Confirmed present in both the v0.3.0
//     spec and the current v1.0 spec.
//   - Capability extensions are declared as
//     `capabilities.extensions[{uri, description, required, params}]`.
//   - The activation header. Verified against the actual spec text, not
//     assumed: the v0.3.0 specification (github.com/a2aproject/A2A, tag
//     v0.3.0, docs/specification.md §5.5.2.1) defines the `AgentExtension`
//     object but names NO activation header at all — the mechanism was
//     unspecified. The header `A2A-Extensions` is a v1.0 addition, confirmed
//     in the current released spec (tag v1.0.1, docs/specification.md
//     §14.2.2). There is no version of the real spec that ever said
//     `X-A2A-Extensions`. Our routes still accept and echo that spelling
//     defensively — it costs one header and matches a naming convention some
//     early client libraries used before the header was standardised — but
//     it is not something either spec says, and the card's prose below no
//     longer claims it is.
//
// Shape decision. A2A v1.0 replaced the v0.3 triple
// (`protocolVersion` + `url` + `preferredTransport` + `additionalInterfaces`)
// with a single `supportedInterfaces: AgentInterface[]`. The deployed
// ecosystem — including the A2A-shaped cards NANDA AI-Catalogs point at today —
// is still on the v0.3 shape. So this card emits the v0.3 fields as primary and
// ALSO carries `supportedInterfaces` for v1.0 readers. Both specs treat the
// card as an open JSON object, so neither reader is broken by the other's
// fields, and neither has to guess.
//
// Honesty note, and it matters: this engine does NOT implement the A2A
// canonical method set (`message/send`, `tasks/get`, …). It exposes its own
// REST API, which is what the card's extension params, the SkillMD and
// openapi.json describe. The card says so in `description` and in the
// extension, rather than implying a JSON-RPC surface that would 404.

import { RAILS } from '../rails.js'
import {
  ENGINE_ENDPOINTS,
  ENGINE_VERSION,
  PROTOCOL,
  WELL_KNOWN,
  abs,
  paymentsExtensionUri,
  type ApiEndpoint,
  type DiscoveryConfig,
} from './endpoints.js'

// ---------------------------------------------------------------------------
// Types (structural subset of the A2A spec objects we populate)
// ---------------------------------------------------------------------------

export interface AgentExtension {
  uri: string
  description: string
  required: boolean
  params?: Record<string, unknown>
}

export interface AgentCapabilities {
  streaming: boolean
  pushNotifications: boolean
  extensions: AgentExtension[]
}

export interface AgentSkill {
  id: string
  name: string
  description: string
  tags: string[]
  examples: string[]
  inputModes: string[]
  outputModes: string[]
}

export interface AgentInterface {
  url: string
  protocolBinding: string
  protocolVersion: string
}

export interface AgentCard {
  protocolVersion: string
  name: string
  description: string
  url: string
  preferredTransport: string
  additionalInterfaces: AgentInterface[]
  /** A2A v1.0 form of the same information. See the note at the top of the file. */
  supportedInterfaces: AgentInterface[]
  provider: { organization: string; url: string }
  version: string
  documentationUrl: string
  iconUrl?: string
  capabilities: AgentCapabilities
  defaultInputModes: string[]
  defaultOutputModes: string[]
  securitySchemes: Record<string, unknown>
  /** v0.3.0 field name and shape (verified: types/src/types.ts at tag v0.3.0). */
  security: Record<string, string[]>[]
  /**
   * v1.0.1 renamed this (verified: specification/a2a.proto, AgentCard field 9)
   * to `securityRequirements: SecurityRequirement[]`, each a `{schemes:
   * map<string, StringList>}`. Emitted alongside `security` — empty either
   * way, since most of this API is deliberately open to whoever holds the
   * id — so a strict v1.0 reader looking for the field under its real
   * current name still finds it, the same reasoning that makes us dual-emit
   * additionalInterfaces/supportedInterfaces above.
   */
  securityRequirements: { schemes: Record<string, string[]> }[]
  skills: AgentSkill[]
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

/**
 * Which endpoints back each advertised skill. Kept next to the skills so the
 * card can publish a real call map instead of prose, and so discovery.test.ts
 * can check every referenced path is one this engine actually registers.
 */
export const SKILL_ENDPOINTS: Record<string, readonly string[]> = {
  create_group_checkout: [
    'POST /v1/groups',
    'GET /v1/members/:id',
    'POST /v1/members/:id/decline',
    'POST /v1/members/:id/hold',
    'POST /v1/members/:id/resume',
    'POST /v1/members/:id/bid',
    'POST /v1/groups/:id/cancel',
  ],
  coordinate_group_plan: [
    'POST /v1/agent/plan',
    'POST /v1/plans',
    'GET /v1/plans/:id',
    'POST /v1/participants/:id/signal',
    'GET /v1/plans/:id/options',
    'POST /v1/plans/:id/choose',
    'POST /v1/plans/:id/convert',
  ],
  split_a_bill: ['POST /v1/bill/parse', 'POST /v1/bill/split'],
  watch_a_group: ['GET /v1/groups/:id', 'GET /v1/groups/:id/events', 'GET /v1/groups/:id/joinable'],
  verify_group_receipt: ['GET /v1/groups/:id/receipt'],
  find_something_to_buy: ['GET /v1/discover/search', 'POST /v1/discover/resolve'],
  coordinate_as_delegate: [
    'PUT /v1/delegate/rules',
    'GET /v1/delegate/rules',
    'GET /v1/plans/:planId/questions',
    'POST /v1/participants/:id/delegate-answer',
  ],
}

function skills(): AgentSkill[] {
  return [
    {
      id: 'create_group_checkout',
      name: 'Create a group checkout',
      description:
        'Take one cart and N people and produce N separate payment mandates, one on each person’s own card, each locked to the merchant and capped at that person’s share. A commit policy (everyone / quorum of m / weighted / veto / required / deadline) decides whether the group commits. Either everyone in the locked set is charged in one window, or every mandate is cancelled and nobody was charged. No pooled funds, nobody fronts money, and the engine never sees a card number. Approval happens on each member’s own device with their own passkey — you get one private approval URL per member to hand out, and you cannot approve for them.',
      tags: ['payments', 'group-checkout', 'split-payment', 'mandates', 'multi-principal', 'gmp1'],
      examples: [
        'Buy 4 tickets to the show tonight and have everyone pay their own share.',
        'Everyone chips in for Maya’s gift, but only go ahead if at least 5 of us are in.',
        'Order the group dinner, and if one person drops out let Arsh’s backstop absorb their share.',
      ],
      inputModes: ['application/json'],
      outputModes: ['application/json'],
    },
    {
      id: 'coordinate_group_plan',
      name: 'Coordinate a group plan',
      description:
        'The phase before a cart exists. From one sentence of intent, work out what the group is even doing: collect each person’s RSVP, free windows, location and budget ceiling privately, geocode the area, pull real venues from OpenStreetMap, and rank concrete options on that evidence. Nothing on the board is invented — the model only fills slots, the geocoder supplies coordinates and the ranker supplies the ordering. When the group picks one, convert the plan into a real group checkout with real mandates.',
      tags: ['coordination', 'scheduling', 'availability', 'places', 'ranking', 'group-decision'],
      examples: [
        'Find somewhere for six of us to eat in Bandra on Friday evening, under ₹800 a head.',
        'When are all of us free next week, and where should we go?',
        'We picked the second option — turn it into a checkout at ₹1200 each.',
      ],
      inputModes: ['application/json'],
      outputModes: ['application/json'],
    },
    {
      id: 'split_a_bill',
      name: 'Split a bill',
      description:
        'Parse a restaurant bill from pasted text (or a photo, when the engine is configured with a vision key) into itemised lines that reconcile against the printed total, assign each line to whoever ordered it, and produce exact per-person amounts. This runs on the at_venue rail: no card is charged through this engine, because a physical bill has no merchant the payment provider can reach. What you get is the arithmetic, an explicit recorded acceptance from each person, and a signed record of who owed what — and never a claim that a payment happened.',
      tags: ['bill-split', 'receipt-parsing', 'itemised', 'at-venue', 'restaurant'],
      examples: [
        'Here is the bill, Dev had the two beers and Maya had the dessert — who owes what?',
        'Split this receipt five ways including tax and service.',
      ],
      inputModes: ['application/json', 'text/plain', 'image/jpeg', 'image/png'],
      outputModes: ['application/json'],
    },
    {
      id: 'watch_a_group',
      name: 'Watch a group',
      description:
        'Follow a live group without polling it to death: a server-sent event stream of every state change (viewed, approved, declined, held, charging, charged, committed, aborted), plus a full state read at any time. Terminal statuses are committed, partial, aborted and expired.',
      tags: ['events', 'sse', 'status', 'monitoring'],
      examples: [
        'Tell me the moment everyone has approved.',
        'Has anyone declined yet, and how long until the deadline?',
      ],
      inputModes: ['application/json'],
      outputModes: ['application/json', 'text/event-stream'],
    },
    {
      id: 'verify_group_receipt',
      name: 'Verify a signed receipt',
      description:
        'Fetch the consent receipt for a settled group: an ordered hash chain of consent objects — each binding a member, the cart hash, their cap, their mandate id and the outcome — headed and Ed25519-signed by the engine, carrying its own public key. Recompute the chain, check the totals against the entries and verify the signature offline. Trust the artifact, not the UI.',
      tags: ['receipt', 'audit', 'ed25519', 'hash-chain', 'verifiable', 'consent'],
      examples: [
        'Prove that everyone in this group consented to what they were charged.',
        'Give me an auditable record of that group purchase.',
      ],
      inputModes: ['application/json'],
      outputModes: ['application/json'],
    },
    {
      id: 'find_something_to_buy',
      name: 'Find something to buy',
      description:
        'Search real merchant catalogs, or resolve a pasted product URL, into a structured priced line the group can then check out against. Prices come from the merchant, never from a model.',
      tags: ['catalog', 'product-search', 'url-resolution', 'commerce'],
      examples: [
        'Find a projector under $300 we could all chip in for.',
        'Resolve this product link into something we can split.',
      ],
      inputModes: ['application/json'],
      outputModes: ['application/json'],
    },
    {
      id: 'coordinate_as_delegate',
      name: 'Coordinate as a delegate',
      description:
        'Act as a coordination delegate for one human, using standing rules they set in advance (a budget ceiling, recurring availability, home location, constraints): read what one plan participant is still being asked, then answer whatever those rules actually cover as ordinary signals. Anything the rules never anticipated is returned unanswered rather than guessed. This is coordination only — it can never approve a payment or move money; that step is a passkey ceremony on the human’s own device, off this surface entirely, the same way Prava itself keeps charging off MCP.',
      tags: ['coordination', 'delegate', 'standing-rules', 'agent-mesh', 'mcp'],
      examples: [
        'My rules say I’m free after 7pm and under ₹800 — answer whatever this plan is asking me on that basis.',
        'What is participant pp_4f still being asked, before I answer for them?',
      ],
      inputModes: ['application/json'],
      outputModes: ['application/json'],
    },
  ]
}

// ---------------------------------------------------------------------------
// Extensions
// ---------------------------------------------------------------------------

/**
 * The GMP/1 capability extension.
 *
 * A2A has no vocabulary for "this agent moves money on behalf of several people
 * at once", and that is precisely the thing a client must understand before
 * calling us. `capabilities.extensions` is the spec's designated place for
 * exactly this, so unlike the AgentFacts case (see agent-facts.ts) no
 * off-spec key is needed here — this is a conforming use of A2A, not a
 * proposed change to it.
 *
 * A client that intends to rely on the multi-principal semantics should
 * activate it by sending the extension URI in `A2A-Extensions` (v1.0) or
 * `X-A2A-Extensions` (v0.3.0). It is `required: false` because the REST
 * endpoints behave identically whether or not you activate it — activation is
 * an acknowledgement that you understood the settlement model, not a switch.
 */
export function gmpExtension(cfg: DiscoveryConfig): AgentExtension {
  return {
    uri: paymentsExtensionUri(cfg),
    description:
      'GMP/1 — the Group Mandate Protocol. This agent coordinates a purchase authorised by N principals at once: one cart, one mandate per person on that person’s own card, each merchant-locked and amount-capped, bound by a commit policy and committed together. Funds are never pooled and never touch this engine. Activate with the A2A-Extensions header (the mechanism A2A v1.0 standardises); we also accept the unstandardised X-A2A-Extensions spelling defensively, but no version of the A2A spec actually names it.',
    required: false,
    params: {
      protocol: PROTOCOL,
      multi_principal: true,
      pools_funds: false,
      fronts_money: false,
      sees_card_numbers: false,
      settlement_provider: 'Prava',
      /**
       * The two settlement rails, read straight out of engine/src/rails.ts so
       * the card can never claim a rail the engine does not implement.
       */
      rails: Object.values(RAILS).map((r) => ({
        rail: r.rail,
        label: r.label,
        charges: r.charges,
        mandates: r.mandates,
        needs_merchant: r.needs_merchant,
        settled_verb: r.settled_verb,
        disclosure: r.disclosure,
      })),
      commit_policies: ['all_of', 'quorum', 'weighted', 'veto', 'required', 'deadline'],
      /** The consent step this agent cannot perform for the user. */
      human_in_the_loop: {
        required: true,
        why: 'Each member approves their own mandate on their own device with their own passkey, on the payment provider’s page. An agent can create the group and hand out the per-member approval URLs; it cannot approve, and must not try.',
      },
      receipt: {
        format: 'gmp1-consent-receipt',
        hash_chain: 'sha256',
        signature: 'ed25519',
        verifiable_offline: true,
        /**
         * The receipt embeds its own public_key, which proves internal
         * consistency (the chain was signed by SOME key) but not that the
         * key is really this engine's — anyone can sign a forged receipt
         * with their own keypair and embed that key. This is the
         * independent source to pin against: fetch it separately, over a
         * separate connection, and refuse a receipt whose public_key
         * differs. See engine/src/receipt.ts's verifyReceipt({
         * expectedPublicKey }) and cli/src/gmp.ts's `gmp verify`, which
         * already does exactly this.
         */
        public_key_endpoint: abs(cfg, WELL_KNOWN.health),
        public_key_field: 'receipt_public_key',
      },
      /** The real call map. Machine-readable, so nobody has to parse prose. */
      api: {
        style: 'REST+JSON over HTTPS (this agent does not implement the A2A canonical method set)',
        base_url: abs(cfg, ''),
        skill_md: abs(cfg, WELL_KNOWN.skillMd),
        endpoints: ENGINE_ENDPOINTS.map(describeEndpoint),
      },
    },
  }
}

function describeEndpoint(e: ApiEndpoint): Record<string, unknown> {
  return {
    method: e.method,
    path: e.path,
    summary: e.summary,
    auth: e.auth,
    ...(e.streaming ? { content_type: 'text/event-stream' } : {}),
  }
}

// ---------------------------------------------------------------------------

export function buildAgentCard(cfg: DiscoveryConfig): AgentCard {
  const version = cfg.version ?? ENGINE_VERSION
  // `protocolBinding`/`preferredTransport` are, per the real spec, an "open
  // form string, to be easily extended for other protocol bindings"
  // (specification/a2a.proto, AgentInterface.protocol_binding) — but
  // `HTTP+JSON` specifically names one of A2A's three CORE bindings, which
  // implies the canonical method surface mapped onto REST
  // (`POST {url}/message:send`, etc. — confirmed live: this engine 404s
  // that). Since the card's own description says outright that the
  // canonical method set is NOT implemented, calling this interface
  // `HTTP+JSON` would tell a spec-literal client the opposite of the truth.
  // `sutra-rest-v1` is spec-legal (open string) and does not imply
  // conformance this engine does not have.
  const REST_BINDING = 'sutra-rest-v1'
  const rest: AgentInterface = {
    url: abs(cfg, '/v1'),
    protocolBinding: REST_BINDING,
    protocolVersion: '0.3.0',
  }

  return {
    protocolVersion: '0.3.0',
    name: 'sutra',
    description:
      'Group checkout for agents. sutra turns one cart and N humans into N card-network-enforced payment mandates — one per person, on that person’s own card, locked to the merchant and capped at their share — and commits them together under a policy: everyone is charged in one window, or every mandate is cancelled and nobody was ever charged. It also does the part before the cart (who is in, when everyone is free, which real venue wins) and the part where there is no chargeable merchant at all (splitting a physical restaurant bill exactly, with a signed record and no false claim of payment). No pooled funds, nobody fronts money, and the engine never sees a card number. Implements GMP/1, the Group Mandate Protocol. Note: this agent speaks its own REST API, described at /skill.md and in the GMP/1 capability extension below — it does not implement the A2A canonical method set.',
    url: rest.url,
    preferredTransport: REST_BINDING,
    additionalInterfaces: [rest],
    supportedInterfaces: [rest],
    provider: {
      organization: 'sutra',
      url: abs(cfg, ''),
    },
    version,
    documentationUrl: abs(cfg, WELL_KNOWN.skillMd),
    capabilities: {
      streaming: true,
      pushNotifications: false,
      extensions: [gmpExtension(cfg)],
    },
    defaultInputModes: ['application/json'],
    defaultOutputModes: ['application/json', 'text/event-stream'],
    securitySchemes: {
      engineBearer: {
        httpAuthSecurityScheme: {
          scheme: 'bearer',
          description:
            'ENGINE_API_TOKEN. Required only to CREATE a group (POST /v1/groups). Reading a group, watching its events and acting as a member need only the unguessable id you were given, so a member can be handed their own URL without being handed the keys to the engine.',
        },
      },
    },
    // No global requirement: most of the surface is intentionally open to
    // whoever holds the id. Listing bearer here would be a lie about the read
    // path and would make agents ask users for a token they do not need.
    // Emitted under both the v0.3.0 field name (`security`) and the current
    // v1.0.1 name (`securityRequirements`) — see the type comment above.
    security: [],
    securityRequirements: [],
    skills: skills(),
  }
}

/** The extension definition document served at WELL_KNOWN.paymentsExtension. */
export function buildExtensionDocument(cfg: DiscoveryConfig): Record<string, unknown> {
  const ext = gmpExtension(cfg)
  return {
    uri: ext.uri,
    name: 'GMP/1 group mandate',
    version: cfg.version ?? ENGINE_VERSION,
    description: ext.description,
    activation: {
      // The real, spec-defined mechanism (A2A v1.0.1, docs/specification.md
      // §14.2.2). Use this one.
      'a2a-1.0': { header: 'A2A-Extensions', value: ext.uri },
      // Accepted and echoed defensively, NOT because any version of the A2A
      // spec defines it — v0.3.0 named no activation header at all. Present
      // only in case a client library adopted this spelling before the
      // header was standardised.
      'unstandardised-legacy-fallback': { header: 'X-A2A-Extensions', value: ext.uri },
    },
    declared_in: abs(cfg, WELL_KNOWN.agentCard),
    specification: abs(cfg, WELL_KNOWN.skillMd),
    params: ext.params,
  }
}
