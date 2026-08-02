import Fastify, { type FastifyInstance } from 'fastify'
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
import { registerRateLimiting } from './rate-limit.js'
import { Social, installSocialSchema } from './social.js'
import { Catalog } from './catalog/index.js'
import { Places } from './places/index.js'
import { Notifier } from './notify/index.js'
import { registerNotifyRoutes } from './notify/routes.js'
import { registerDiscoveryRoutes } from './discovery/routes.js'
import { PlanService } from './plan/service.js'
import { PlanStore, installPlanSchema } from './plan/store.js'
import { registerDelegateRoutes } from './delegate/routes.js'
import { DelegateStore, installDelegateSchema } from './delegate/store.js'
import { registerMessageRoutes } from './messages/routes.js'
import { GroupService } from './service.js'
import { MockPrava } from './prava/mock.js'
import { PravaClient } from './prava/client.js'
import type { PravaAdapter } from './prava/adapter.js'
import { ShopifyTestOrderClient } from './shopify/test-order.js'

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

/**
 * routes.ts replaces Fastify's default JSON body parser so action endpoints
 * with no body at all (POST /open, /decline, …) don't 400 on emptiness — but
 * on genuinely malformed JSON it hands the shared error handler a bare
 * SyntaxError with no `statusCode`. That handler only turns errors carrying a
 * 4xx statusCode into a clean 4xx reply; anything else falls through to a
 * bare 500 "internal error", which is what three independent reports of
 * POST /v1/auth/register 500ing on bad JSON turned out to be. It is not one
 * route's bug — every route on this app shares the same parser and handler —
 * so the fix is re-registered here, centrally, after registerRoutes has
 * installed its own: same tolerant-of-empty-bodies behavior, but a parse
 * failure now carries statusCode 400 and a message naming the actual JSON
 * error, which the existing handler already knows how to turn into a real
 * 4xx. PowerShell 5.1's default quoting mangles JSON payloads routinely, so
 * this is the first thing a judge on Windows hits testing the REST API by
 * hand — see engine/test/malformed-body.test.ts.
 */
export function installMalformedJsonGuard(app: FastifyInstance): void {
  app.removeContentTypeParser('application/json')
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    if (!body || (typeof body === 'string' && body.trim() === '')) return done(null, {})
    try {
      done(null, JSON.parse(body as string))
    } catch (e) {
      const err = e as Error & { statusCode?: number }
      err.statusCode = 400
      err.message = `malformed JSON body: ${err.message}`
      done(err)
    }
  })
}

function buildShopifyTestAdapter(): ShopifyTestOrderClient | undefined {
  if (process.env.SHOPIFY_TEST_ORDER_ENABLED !== 'true') return undefined
  const storeDomain = process.env.SHOPIFY_TEST_STORE
  const accessToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN
  const clientId = process.env.SHOPIFY_ADMIN_CLIENT_ID
  const clientSecret = process.env.SHOPIFY_ADMIN_CLIENT_SECRET
  if (!storeDomain || (!accessToken && !(clientId && clientSecret))) {
    console.error(
      'SHOPIFY_TEST_ORDER_ENABLED=true but SHOPIFY_TEST_STORE is missing, or neither SHOPIFY_ADMIN_ACCESS_TOKEN nor SHOPIFY_ADMIN_CLIENT_ID/SHOPIFY_ADMIN_CLIENT_SECRET is set — proof disabled',
    )
    return undefined
  }
  return new ShopifyTestOrderClient({
    storeDomain,
    storefrontDomain: process.env.SHOPIFY_STOREFRONT_DOMAIN,
    accessToken,
    clientId,
    clientSecret,
    apiVersion: process.env.SHOPIFY_API_VERSION,
  })
}

export async function main(): Promise<{ app: FastifyInstance; close: () => Promise<void> }> {
  const db = new Db(DB_PATH)
  const hub = new EventHub(db, process.env.WEBHOOK_SECRET ?? 'dev-webhook-secret')
  const signer = new ReceiptSigner(process.env.ENGINE_SIGNING_SEED || undefined)
  const prava = buildAdapter()
  const shopifyTest = buildShopifyTestAdapter()
  // Inbox before GroupService so invite/commit moments can notify.
  const notifier = new Notifier(db)
  const service = new GroupService(db, prava, hub, signer, {
    appBaseUrl: APP_BASE_URL,
    notifier,
  })
  const poller = new Poller(service)

  // trustProxy: both Railway (direct hits) and the web app's own BFF proxy
  // sit in front of this process, so the real caller's address only ever
  // arrives via X-Forwarded-For. Without this, request.ip is the last hop's
  // address — Railway's edge or Vercel's egress IP — which is the same for
  // every request no matter who is actually asking, and the rate limiter
  // below would treat the entire internet as one caller.
  const app = Fastify({ logger: { level: 'warn' }, trustProxy: true })
  // Only matters to a caller that started the engine in-process and closes
  // it again (npm run demo's cold-start path) — release the sqlite handle
  // once nothing can reach it through the HTTP layer anymore.
  app.addHook('onClose', async () => db.close())

  const apiToken = process.env.ENGINE_API_TOKEN
  if (!apiToken) {
    if (process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT) {
      throw new Error('ENGINE_API_TOKEN must be set in production')
    }
  }
  const resolvedToken = apiToken ?? 'dev-token'
  await registerRateLimiting(app)

  installSocialSchema(db)
  const social = new Social(db)

  registerRoutes(app, service, poller, {
    apiToken: resolvedToken,
    appBaseUrl: APP_BASE_URL,
    shopifyTest,
    social: {
      userFor: (req) => currentUserFrom(social, req),
      assertSeatable: (actorId, seats) => social.assertSeatable(actorId, seats),
    },
  })
  installMalformedJsonGuard(app)

  const configuredShopifyDomains = process.env.SHOPIFY_DOMAINS
    ? process.env.SHOPIFY_DOMAINS.split(',')
    : [
        ...(shopifyTest ? [shopifyTest.storefrontDomain] : []),
        'allbirds.com',
        'gymshark.com',
        'fashionnova.com',
        'kyliecosmetics.com',
        'bombayshavingcompany.com',
        'boat-lifestyle.com',
        'mamaearth.in',
        'beardo.in',
      ]
  const catalog = new Catalog({
    // Any Shopify storefront works; these are only the default shelf searched
    // when the user does not scope the query to a merchant.
    // The default shelf, when a query is not scoped to one store. Every domain
    // here was verified to answer Shopify's public /search/suggest.json with
    // real products and real prices — a store that 404s that endpoint makes the
    // whole search look broken, so nothing goes in this list unchecked.
    // Deliberately spread across US and Indian storefronts, since the split is
    // as likely to be in rupees as dollars.
    shopifyDomains: configuredShopifyDomains
      .map((s) => s.trim())
      .filter(Boolean),
  })
  // ---- the coordination layer -------------------------------------------
  // Everything that happens before a cart exists: who is in, when they are
  // free, where they are, and which real option wins on that evidence.
  installPlanSchema(db)
  const planStore = new PlanStore(db)
  const places = new Places()

  // Notifications: the inbox always works; push only once VAPID keys exist.
  // Delivery is fire-and-forget by construction — nothing here can fail a
  // protocol path. (Notifier constructed earlier so GroupService can use it.)

  registerProductRoutes(app, service, social, catalog, planStore, notifier)
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
    apiToken: resolvedToken,
    notifier,
  })

  // ---- delegate agents -----------------------------------------------------
  // Standing rules a human sets in advance, so their own agent can answer the
  // coordination questions above (in/when/where/budget) without either human
  // in the loop or an invented answer. Never a payment path — see
  // engine/src/delegate/rules.ts and docs/AGENT-MESH.md.
  installDelegateSchema(db)
  const delegateStore = new DelegateStore(db)
  registerDelegateRoutes(app, { store: delegateStore, plans, planStore, social })

  // ---- messages ------------------------------------------------------------
  // A live thread on a plan or a group, riding the SAME event logs and SSE
  // streams those already have — no new transport. Tagging @sutra gets a
  // reply from the same delegate machinery above, in the room.
  registerMessageRoutes(app, {
    plans,
    planStore,
    groups: service,
    delegateStore,
    social,
    currentUser: (req) => currentUserFrom(social, req),
    apiToken: resolvedToken,
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

  return {
    app,
    // For callers that started the engine themselves (currently just `npm
    // run demo`'s cold-start path — see cli/src/gmp.ts) and need to tear it
    // back down afterwards: stop the poller, then close the HTTP server and
    // let db.ts release its own handle via Fastify's onClose hook below.
    close: async () => {
      poller.stop()
      await app.close()
    },
  }
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirectRun) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
