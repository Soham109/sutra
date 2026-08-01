import Fastify from 'fastify'
import { readFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Db } from './db.js'
import { EventHub } from './events.js'
import { Poller } from './poller.js'
import { ReceiptSigner } from './receipt.js'
import { registerRoutes } from './routes.js'
import { registerProductRoutes, currentUserFrom } from './routes-v2.js'
import { registerPlanRoutes } from './routes-plan.js'
import { Social, installSocialSchema } from './social.js'
import { Catalog } from './catalog/index.js'
import { Places } from './places/index.js'
import { Notifier } from './notify/index.js'
import { registerNotifyRoutes } from './notify/routes.js'
import { registerDiscoveryRoutes } from './discovery/routes.js'
import { PlanService } from './plan/service.js'
import { PlanStore, installPlanSchema } from './plan/store.js'
import { GroupService } from './service.js'
import { MockPrava } from './prava/mock.js'
import { PravaClient } from './prava/client.js'
import type { PravaAdapter } from './prava/adapter.js'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..')

try {
  process.loadEnvFile(join(repoRoot, '.env'))
} catch {
  // no .env — env vars or defaults apply
}

const PORT = Number(process.env.PORT ?? 4100)
const APP_BASE_URL = process.env.APP_BASE_URL ?? `http://localhost:${PORT}`
const PRAVA_ENV = process.env.PRAVA_ENV ?? 'mock'
const DB_PATH = process.env.DB_PATH ?? join(repoRoot, 'data', 'gmp.db')

if (process.env.NODE_ENV === 'production' && !process.env.DB_PATH) {
  throw new Error('DB_PATH is required in production. Mount a persistent Railway volume at /data and set DB_PATH=/data/gmp.db.')
}

function buildAdapter(): PravaAdapter {
  if (PRAVA_ENV === 'mock') return new MockPrava(APP_BASE_URL)
  const key = process.env.PRAVA_API_KEY
  if (!key) {
    console.error('PRAVA_ENV is not mock but PRAVA_API_KEY is missing — falling back to mock')
    return new MockPrava(APP_BASE_URL)
  }
  return new PravaClient(process.env.PRAVA_BASE_URL ?? 'https://sandbox.api.prava.space', key)
}

export async function main(): Promise<void> {
  const db = new Db(DB_PATH)
  const hub = new EventHub(db, process.env.WEBHOOK_SECRET ?? 'dev-webhook-secret')
  const signer = new ReceiptSigner(process.env.ENGINE_SIGNING_SEED || undefined)
  const prava = buildAdapter()
  const service = new GroupService(db, prava, hub, signer, { appBaseUrl: APP_BASE_URL })
  const poller = new Poller(service)

  const app = Fastify({ logger: { level: 'warn' } })

  registerRoutes(app, service, poller, {
    apiToken: process.env.ENGINE_API_TOKEN ?? 'dev-token',
    appBaseUrl: APP_BASE_URL,
  })

  installSocialSchema(db)
  const social = new Social(db)
  const catalog = new Catalog({
    // Any Shopify storefront works; these are only the default shelf searched
    // when the user does not scope the query to a merchant.
    shopifyDomains: (process.env.SHOPIFY_DOMAINS ?? 'shop.polymer.co,gymshark.com,allbirds.com')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  })
  // ---- the coordination layer -------------------------------------------
  // Everything that happens before a cart exists: who is in, when they are
  // free, where they are, and which real option wins on that evidence.
  installPlanSchema(db)
  const planStore = new PlanStore(db)
  const places = new Places()

  registerProductRoutes(app, service, social, catalog, planStore)

  // Notifications: the inbox always works; push only once VAPID keys exist.
  // Delivery is fire-and-forget by construction — nothing here can fail a
  // protocol path.
  const notifier = new Notifier(db)
  registerNotifyRoutes(app, notifier, social)

  // ---- agent discovery ---------------------------------------------------
  // A2A agent card, NANDA AgentFacts, the AI Catalog, and SKILL.md — served
  // from the real route list so another agent can find this engine and use it
  // without a human introducing them.
  registerDiscoveryRoutes(app, { baseUrl: APP_BASE_URL })
  const plans = new PlanService({ store: planStore, groups: service, places, catalog, social })
  registerPlanRoutes(app, {
    plans,
    store: planStore,
    groups: service,
    places,
    social,
    currentUser: (req) => currentUserFrom(social, req),
  })

  // Liveness for the platform, and a fast way for a human to tell which build
  // is actually running. Deliberately unauthenticated and cheap: a health
  // check that touches the database is a health check that takes the service
  // down with the database.
  app.get('/health', async () => ({
    ok: true,
    service: 'sutra-gmp-engine',
    prava_adapter: prava.kind,
    app_base_url: APP_BASE_URL,
    receipt_public_key: signer.publicKeyHex,
    uptime_s: Math.round(process.uptime()),
  }))

  // ---- legacy zero-build surfaces --------------------------------------
  // The product UI is the Next.js app in /web (deployed separately). These
  // stay because they need no build step: they are the offline fallback for
  // the demo and the reference implementation of the /v1 contract.
  const webDir = join(here, '..', 'public')
  const serve = (name: string, type = 'text/html; charset=utf-8') =>
    async (_req: unknown, reply: { type: (t: string) => { send: (b: string) => unknown } }) =>
      reply.type(type).send(readFileSync(join(webDir, name), 'utf8'))

  app.get('/', serve('index.html'))
  app.get('/new', serve('new.html'))
  app.get('/a/:memberId', serve('approve.html'))
  app.get('/g/:groupId/board', serve('board.html'))
  app.get('/g/:groupId/receipt', serve('receipt.html'))
  app.get('/g/:groupId/share', serve('share.html'))
  app.get('/g/:groupId/totem', serve('totem.html'))
  app.get('/j/:groupId', serve('join.html')) // the totem's shared-join page (§21.2)
  app.get('/widget-demo', serve('widget-demo.html'))
  app.get('/app.css', serve('app.css', 'text/css'))
  app.get('/app.js', serve('app.js', 'text/javascript'))
  app.get('/widget.js', async (_req, reply) =>
    reply.type('text/javascript').send(readFileSync(join(repoRoot, 'widget', 'widget.js'), 'utf8')))

  await poller.recoverOnBoot()
  poller.start()

  await app.listen({ port: PORT, host: '0.0.0.0' })
  console.log(`
  ┌──────────────────────────────────────────────────────┐
  │  sutra · GMP/1 engine                                │
  │  ${APP_BASE_URL.padEnd(50)}  │
  │  prava adapter: ${prava.kind.padEnd(37)} │
  │  receipt key:   ${signer.publicKeyHex.slice(0, 32).padEnd(37)} │
  └──────────────────────────────────────────────────────┘
  organizer:  ${APP_BASE_URL}/new
`)
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirectRun) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
