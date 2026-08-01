// The AI Catalog document served at /api/agents.
//
// This is the third link in NANDA's de-facto discovery chain, verified against
// a live record on 2026-08-01:
//
//   NANDA Index record (https://api.nandaindex.org/api/v1/index)
//     → its `registry_url`                       e.g. https://travel26.net/api
//       → GET <registry_url>/agents              an AI Catalog
//         → {specVersion, entries[]}
//           → each entry's `url`                 an A2A-shaped card
//             conventionally /.well-known/agents/<slug>.json
//
// A live catalog (travel26.net/api/agents) returns exactly
// `{"specVersion":"1.0","entries":[{identifier, displayName, mediaType, url,
// description, tags, version, updatedAt, metadata}]}` and serves it as
// `application/json; charset=utf-8`. This module reproduces that shape.
//
// Our index record therefore wants `registry_url = <base>/api` and
// `media_type = application/ai-catalog+json`; buildIndexRecord() below emits
// that body so the CLI never has to hand-assemble it.

import {
  AGENT_SLUG,
  ENGINE_VERSION,
  WELL_KNOWN,
  abs,
  domainUrn,
  normalizeBaseUrl,
  type DiscoveryConfig,
} from './endpoints.js'

/** Matches the live NANDA AI-Catalog wire format. */
export interface CatalogEntry {
  identifier: string
  displayName: string
  mediaType: string
  url: string
  description: string
  tags: string[]
  version: string | null
  updatedAt: string
  metadata: Record<string, unknown>
}

export interface AiCatalog {
  specVersion: string
  entries: CatalogEntry[]
}

/** Observed on the live catalog. A string, not a number — "1.0", not 1.0. */
export const CATALOG_SPEC_VERSION = '1.0'

/** Seconds a consumer may cache these documents. Within the index's 3600–604800 bound. */
export const CATALOG_TTL_SECONDS = 3600

export function buildCatalog(cfg: DiscoveryConfig): AiCatalog {
  const version = cfg.version ?? ENGINE_VERSION
  const updatedAt = cfg.now ?? new Date().toISOString()
  const common = { ttl_seconds: CATALOG_TTL_SECONDS, status: 'active' }

  return {
    specVersion: CATALOG_SPEC_VERSION,
    entries: [
      {
        identifier: AGENT_SLUG,
        displayName: 'sutra — group checkout (GMP/1)',
        mediaType: 'application/a2a-agent-card+json',
        // The catalog-conventional path, not /.well-known/agent-card.json.
        // Both serve the identical card; this one is the discoverable-by-slug
        // form a catalog entry is expected to point at.
        url: abs(cfg, WELL_KNOWN.namedAgentCard),
        description:
          'One cart, N people, N card-network-enforced payment mandates, committed together: everyone is charged in one window or nobody is. Also coordinates the plan before the cart and splits a physical restaurant bill exactly. No pooled funds, no card numbers.',
        tags: [
          'payments',
          'agentic-commerce',
          'group-checkout',
          'split-payment',
          'multi-principal',
          'mandates',
          'coordination',
          'gmp1',
          'prava',
        ],
        version,
        updatedAt,
        metadata: {
          ...common,
          'org.projectnanda.resolutionRole': 'a2a-agent-card',
          protocol: 'GMP/1',
          /** Sibling representations of the same agent, for a resolver that prefers one. */
          agentCardUrl: abs(cfg, WELL_KNOWN.agentCard),
          agentFactsUrl: abs(cfg, WELL_KNOWN.agentFacts),
          skillMdUrl: abs(cfg, WELL_KNOWN.skillMd),
        },
      },
      {
        identifier: `${AGENT_SLUG}-agent-facts`,
        displayName: 'sutra — AgentFacts',
        // Not one of the five media types the NANDA Index enumerates for an
        // index record; catalog entries carry a free-form mediaType, and this
        // is the honest one for an AgentFacts document.
        mediaType: 'application/agentfacts+json',
        url: abs(cfg, WELL_KNOWN.agentFacts),
        description:
          'NANDA AgentFacts record for sutra, valid against https://agentfacts.org/schema/v1, plus a namespaced non-standard x-payments block describing the settlement model the base schema has no vocabulary for.',
        tags: ['agentfacts', 'nanda', 'payments', 'discovery'],
        version,
        updatedAt,
        metadata: {
          ...common,
          schema: 'https://agentfacts.org/schema/v1',
          'org.projectnanda.resolutionRole': 'agent-facts',
        },
      },
      {
        identifier: `${AGENT_SLUG}-skillmd`,
        displayName: 'sutra — SkillMD',
        mediaType: 'text/markdown',
        url: abs(cfg, WELL_KNOWN.skillMd),
        description:
          'Plain-Markdown instructions for calling this engine: base URL, every endpoint with an example curl and an example response, and the numbered steps an agent should follow.',
        tags: ['skillmd', 'nandatown', 'openclaw', 'documentation'],
        version,
        updatedAt,
        metadata: { ...common, 'org.projectnanda.resolutionRole': 'skill-md' },
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// NANDA Index v2 record
// ---------------------------------------------------------------------------

/**
 * The body for `POST https://api.nandaindex.org/api/v1/orgs`.
 *
 * Verified against the live OpenAPI document (api.nandaindex.org/docs/json,
 * "NANDA Index Server", version 2.0.0) on 2026-08-01. Only `org_id`,
 * `display_name` and `contact_email` are actually required by the server;
 * everything else here is optional but is what makes the record resolvable
 * rather than merely present.
 */
export interface NandaIndexRecord {
  org_id: string
  display_name: string
  contact_email: string
  hosting_path: 'registry' | 'dns-aid' | 'smb' | 'personal'
  domain: string
  registry_url: string
  identifier: string
  media_type: 'application/ai-catalog+json'
  description: string
  tags: string[]
  version: string
  ttl_seconds: number
  publisher: { identifier: string; displayName: string; identityType: string }
  metadata: Record<string, unknown>
}

export interface IndexRecordOptions {
  /** `^[a-z0-9][a-z0-9-]*[a-z0-9]$`, 2–64 chars. Defaults to the agent slug. */
  orgId?: string
  contactEmail: string
  ttlSeconds?: number
}

export function buildIndexRecord(cfg: DiscoveryConfig, opts: IndexRecordOptions): NandaIndexRecord {
  const base = normalizeBaseUrl(cfg.baseUrl)
  const domain = new URL(base).hostname
  const orgId = opts.orgId ?? AGENT_SLUG
  const identifier = domainUrn(cfg)

  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(orgId) || orgId.length < 2 || orgId.length > 64) {
    throw new Error(
      `nanda index: org_id must match ^[a-z0-9][a-z0-9-]*[a-z0-9]$ and be 2-64 chars, got ${JSON.stringify(orgId)}`,
    )
  }

  return {
    org_id: orgId,
    display_name: 'sutra — group checkout (GMP/1)',
    contact_email: opts.contactEmail,
    // We host our own catalog at <base>/api/agents rather than delegating to a
    // shared registry or a DNS-AID pointer.
    hosting_path: 'registry',
    domain,
    // The index points at the catalog's PARENT; the resolver appends /agents.
    registry_url: `${base}/api`,
    identifier,
    media_type: 'application/ai-catalog+json',
    description:
      'Multi-principal group checkout. One cart, N people, N card-network-enforced payment mandates, committed together — everyone is charged in one window or nobody is. No pooled funds, nobody fronts money, the engine never sees a card number.',
    tags: [
      'payments',
      'agentic-commerce',
      'group-checkout',
      'split-payment',
      'multi-principal',
      'mandates',
      'coordination',
      'gmp1',
      'prava',
    ],
    version: cfg.version ?? ENGINE_VERSION,
    ttl_seconds: opts.ttlSeconds ?? 86400,
    publisher: { identifier, displayName: 'sutra', identityType: 'dns' },
    metadata: {
      'org.projectnanda.resolutionRole': 'nested-ai-catalog',
      'org.projectnanda.preferredDiscovery': 'ai-catalog',
      agentCardUrl: abs(cfg, WELL_KNOWN.agentCard),
      agentFactsUrl: abs(cfg, WELL_KNOWN.agentFacts),
      skillMdUrl: abs(cfg, WELL_KNOWN.skillMd),
    },
  }
}
