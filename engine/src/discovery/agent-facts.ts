// NANDA AgentFacts for this engine.
//
// Validated against the REAL schema, fetched 2026-08-01 from
//   https://raw.githubusercontent.com/projnanda/agentfacts-format/main/agentfacts_schema.json
//   ($id: https://agentfacts.org/schema/v1, JSON Schema draft-07)
// and vendored byte-for-byte at engine/test/fixtures/agentfacts_schema.json.
// engine/test/discovery.test.ts validates the document produced here against
// that vendored copy, so this file cannot drift from the published schema
// without a test going red.
//
// Required top level: id, agent_name, label, description, version, provider,
// endpoints, capabilities, skills.

import { RAILS } from '../rails.js'
import {
  AGENT_SLUG,
  ENGINE_ENDPOINTS,
  ENGINE_VERSION,
  PROTOCOL,
  WELL_KNOWN,
  abs,
  normalizeBaseUrl,
  type DiscoveryConfig,
} from './endpoints.js'

export interface AgentFactsSkill {
  id: string
  description: string
  inputModes: string[]
  outputModes: string[]
  supportedLanguages?: string[]
  latencyBudgetMs?: number
  maxTokens?: number
}

export interface AgentFacts {
  id: string
  agent_name: string
  label: string
  description: string
  version: string
  documentationUrl?: string
  jurisdiction?: string
  provider: { name: string; url: string; did?: string }
  endpoints: { static: string[]; adaptive_resolver?: { url?: string; policies?: string[] } }
  capabilities: {
    modalities: string[]
    streaming?: boolean
    batch?: boolean
    authentication: { methods: string[]; requiredScopes?: string[] }
  }
  skills: AgentFactsSkill[]
  telemetry?: Record<string, unknown>
  /** See PAYMENTS_EXTENSION_KEY. Proposed, non-standard. */
  'x-payments'?: PaymentsExtension
}

// ---------------------------------------------------------------------------
// PROPOSED EXTENSION — NOT PART OF AgentFacts v1
// ---------------------------------------------------------------------------
//
// READ THIS BEFORE COPYING ANYTHING BELOW.
//
// The published AgentFacts schema (draft-07, $id https://agentfacts.org/schema/v1)
// has NO payment vocabulary of any kind. There is no field for "this agent can
// spend money", none for who it spends it on behalf of, none for whether it
// custodies funds, and none for which settlement rail it uses. We checked the
// real schema, not a summary of it: the complete property set is id,
// agent_name, label, description, version, documentationUrl, jurisdiction,
// provider, endpoints, capabilities, skills, evaluations, telemetry,
// certification. That is the whole vocabulary.
//
// For a discovery layer that is meant to let agents find and trust each other,
// that gap is load-bearing. "Can this agent move my money, and under what
// custody model?" is not a nice-to-have detail — it is the single fact a
// calling agent most needs before it hands over a user's intent. An agent that
// summarises text and an agent that charges four people's cards are
// indistinguishable in an AgentFacts record today.
//
// So this file adds a NAMESPACED, EXPLICITLY NON-STANDARD block under the key
// `x-payments`. The `x-` prefix is the long-standing convention for a vendor
// extension that has not been standardised, and it is chosen precisely so that
// nobody can mistake it for spec. Concretely:
//
//   * It is NOT in AgentFacts v1. It is a proposal, offered as a strawman for
//     what a payments section could look like, not an announcement.
//   * The base schema does not forbid additional top-level properties, so the
//     document remains VALID against the real schema with this block present.
//     discovery.test.ts asserts exactly that, both with and without it.
//   * Any consumer that does not know this key MUST ignore it, and loses
//     nothing it had before.
//   * If AgentFacts ever standardises a payments section under a different
//     name or shape, this block should be deleted, not renamed and kept.
//
// The fields below are deliberately about custody and consent rather than
// about product features, because those are the properties another agent has
// to reason about: does this thing hold my money (no), does it ever front it
// (no), does it see a card number (no), how many principals authorise one
// action (N, independently), and what actually enforces the limit (the card
// network, not the app asking).
// ---------------------------------------------------------------------------

export const PAYMENTS_EXTENSION_KEY = 'x-payments' as const

export interface PaymentsExtension {
  /** Loud, so no reader can mistake this for part of AgentFacts v1. */
  $comment: string
  /** Identifies the shape of this proposed block, so a later revision is detectable. */
  proposal: string
  status: 'proposed-extension'
  /** Where the concrete, spec-conforming version of this lives today (A2A). */
  standard_equivalent: string

  /** Can this agent cause money to move at all? */
  payment_capable: boolean
  /** Do several people independently authorise one action? The whole point of GMP/1. */
  multi_principal: boolean
  /** Upper bound on principals per action, if any. */
  max_principals: number | null
  /** Custody posture — the questions a calling agent actually needs answered. */
  custody: {
    pools_funds: boolean
    holds_funds: boolean
    fronts_money: boolean
    /** Does the coordinator ever see a PAN? */
    sees_card_numbers: boolean
    /** Who enforces the spend cap: the app, or the network? */
    limit_enforced_by: string
    money_transmitter: boolean
  }
  /** Who mints the credential that actually pays the merchant. */
  settlement_provider: { name: string; instrument: string }
  /** The consent step no agent may perform for the user. */
  consent: {
    human_in_the_loop: boolean
    method: string
    agent_may_approve_on_behalf: false
    note: string
  }
  /** The rails, generated from engine/src/rails.ts — never hand-written here. */
  rails: {
    rail: string
    label: string
    charges: boolean
    mandates: boolean
    needs_merchant: boolean
    settled_verb: string
    disclosure: string
  }[]
  /** How a settlement can be verified after the fact, by anyone, offline. */
  receipt: {
    format: string
    hash_chain: string
    signature: string
    verifiable_offline: boolean
    endpoint: string
  }
  protocol: { name: string; specification: string }
}

function paymentsExtension(cfg: DiscoveryConfig): PaymentsExtension {
  return {
    $comment:
      'PROPOSED EXTENSION — NOT part of the AgentFacts v1 schema (https://agentfacts.org/schema/v1), which contains no payment vocabulary at all. Namespaced under "x-" so it cannot be mistaken for spec. Consumers that do not recognise this key MUST ignore it; the document is valid against the base schema with or without it.',
    proposal: 'agentfacts-x-payments/draft-0',
    status: 'proposed-extension',
    standard_equivalent: `The A2A capability extension declared at ${abs(cfg, WELL_KNOWN.agentCard)} carries the same facts using a mechanism that IS standardised (capabilities.extensions).`,

    payment_capable: true,
    multi_principal: true,
    max_principals: 30,
    custody: {
      pools_funds: false,
      holds_funds: false,
      fronts_money: false,
      sees_card_numbers: false,
      limit_enforced_by:
        'the card network — each mandate is a single-use, merchant-locked, amount-capped credential, so the cap holds even if this engine is wrong or compromised',
      money_transmitter: false,
    },
    settlement_provider: {
      name: 'Prava',
      instrument: 'single-use merchant-locked amount-capped card mandate, minted per member',
    },
    consent: {
      human_in_the_loop: true,
      method: 'passkey on the payment provider’s own hosted page, on the member’s own device',
      agent_may_approve_on_behalf: false,
      note: 'An agent can create the group and hand each member their own approval URL. It cannot approve for them, and must not try — the approval is what makes the mandate theirs.',
    },
    rails: Object.values(RAILS).map((r) => ({
      rail: r.rail,
      label: r.label,
      charges: r.charges,
      mandates: r.mandates,
      needs_merchant: r.needs_merchant,
      settled_verb: r.settled_verb,
      disclosure: r.disclosure,
    })),
    receipt: {
      format: 'gmp1-consent-receipt',
      hash_chain: 'sha256',
      signature: 'ed25519',
      verifiable_offline: true,
      endpoint: abs(cfg, '/v1/groups/:id/receipt'),
    },
    protocol: {
      name: PROTOCOL,
      specification: abs(cfg, WELL_KNOWN.skillMd),
    },
  }
}

// ---------------------------------------------------------------------------

function skills(): AgentFactsSkill[] {
  const json = ['application/json']
  return [
    {
      id: 'create_group_checkout',
      description:
        'Create a group checkout: one cart, N members, one merchant-locked amount-capped payment mandate per member on their own card, committed together under a policy (all_of / quorum / weighted / veto / required / deadline). Everyone in the locked set is charged in one window, or every mandate is cancelled and nobody was charged. Returns one private approval URL per member; each member approves on their own device with their own passkey.',
      inputModes: json,
      outputModes: json,
      supportedLanguages: ['en'],
      latencyBudgetMs: 5000,
    },
    {
      id: 'coordinate_group_plan',
      description:
        'Coordinate the phase before a cart exists: collect each participant’s RSVP, free windows, location and budget ceiling privately, geocode the area, pull real venues from OpenStreetMap, and rank concrete options on that evidence. Converts into a group checkout when the group chooses one.',
      inputModes: json,
      outputModes: json,
      supportedLanguages: ['en'],
      latencyBudgetMs: 20000,
    },
    {
      id: 'split_a_bill',
      description:
        'Parse a restaurant bill from text (or a photo, when the engine is configured with a vision key) into itemised lines that reconcile against the printed total, allocate each line to whoever ordered it, and record explicit per-person acceptance. Runs on the at_venue rail: no card is charged through this engine, and the output never claims one was.',
      inputModes: ['application/json', 'text/plain', 'image/jpeg', 'image/png'],
      outputModes: json,
      supportedLanguages: ['en'],
      latencyBudgetMs: 45000,
    },
    {
      id: 'watch_a_group',
      description:
        'Follow a live group: a server-sent event stream of every state change, plus a full state read at any time. Terminal statuses are committed, partial, aborted, expired.',
      inputModes: json,
      outputModes: ['application/json', 'text/event-stream'],
      supportedLanguages: ['en'],
      latencyBudgetMs: 2000,
    },
    {
      id: 'verify_group_receipt',
      description:
        'Fetch the consent receipt for a settled group: an ordered hash chain of consent objects binding member, cart hash, cap, mandate id and outcome, Ed25519-signed and carrying its own public key, verifiable offline by anyone.',
      inputModes: json,
      outputModes: json,
      supportedLanguages: ['en'],
      latencyBudgetMs: 1000,
    },
    {
      id: 'find_something_to_buy',
      description:
        'Search real merchant catalogs, or resolve a pasted product URL, into a structured priced line the group can check out against. Prices come from the merchant, never from a model.',
      inputModes: json,
      outputModes: json,
      supportedLanguages: ['en'],
      latencyBudgetMs: 15000,
    },
  ]
}

export interface AgentFactsOptions {
  /**
   * Include the proposed, non-standard `x-payments` block. Defaults to true.
   * Set false to emit a document containing nothing but AgentFacts v1
   * vocabulary — useful for proving the extension is additive.
   */
  includePaymentsExtension?: boolean
}

export function buildAgentFacts(cfg: DiscoveryConfig, opts: AgentFactsOptions = {}): AgentFacts {
  const host = new URL(normalizeBaseUrl(cfg.baseUrl)).hostname

  const facts: AgentFacts = {
    // The canonical, dereferenceable location of this document. Unique by
    // construction and resolvable, which a bare slug would not be.
    id: abs(cfg, WELL_KNOWN.agentFacts),
    // The schema calls this the "Agent URN identifier". Shaped to match the URN
    // family the NANDA Index uses for records (`urn:ai:domain:<domain>`), one
    // level down for the agent itself.
    agent_name: `urn:ai:agent:${host}:${AGENT_SLUG}`,
    label: 'sutra — group checkout (GMP/1)',
    description:
      'Group checkout for agents. Turns one cart and N humans into N card-network-enforced payment mandates — one per person, on that person’s own card, merchant-locked and capped at their share — committed together under a policy: everyone is charged in one window, or every mandate is cancelled and nobody was ever charged. Also coordinates the phase before the cart (who is in, when everyone is free, which real venue wins) and the case with no chargeable merchant at all (splitting a physical restaurant bill exactly, with a signed record and no false claim of payment). No pooled funds, nobody fronts money, the engine never sees a card number. Implements GMP/1, the Group Mandate Protocol.',
    version: cfg.version ?? ENGINE_VERSION,
    documentationUrl: abs(cfg, WELL_KNOWN.skillMd),
    provider: {
      name: 'sutra',
      url: abs(cfg, ''),
    },
    endpoints: {
      static: [
        abs(cfg, '/v1'),
        ...ENGINE_ENDPOINTS.map((e) => abs(cfg, e.path)),
        abs(cfg, WELL_KNOWN.agentCard),
        abs(cfg, WELL_KNOWN.catalog),
        abs(cfg, WELL_KNOWN.skillMd),
      ],
    },
    capabilities: {
      modalities: ['text', 'application/json', 'text/event-stream', 'image'],
      streaming: true,
      batch: false,
      authentication: {
        // Two postures, deliberately. Creating a group needs the engine bearer
        // token; reading a group, watching its stream and acting as a member
        // need only the unguessable id, so a member can be given their own URL
        // without being given the keys to the engine.
        methods: ['bearer', 'none'],
        requiredScopes: [],
      },
    },
    skills: skills(),
    telemetry: {
      // Stated rather than omitted: "we do not collect this" is itself a fact
      // another agent may want before routing a user's purchase through us.
      enabled: false,
      retention: 'none',
    },
  }

  if (opts.includePaymentsExtension !== false) {
    facts[PAYMENTS_EXTENSION_KEY] = paymentsExtension(cfg)
  }
  return facts
}
