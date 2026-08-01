// Rate limiting: nothing stood between a script and an unlimited password
// guess. A live probe fired 20 back-to-back POST /v1/auth/login attempts in
// 16 seconds and got 20 clean 401s — no 429, no backoff, no @fastify/rate-limit
// anywhere in package.json.
//
// The constraint that shapes every number in here: the demo runs off one
// conference-wifi router. Several phones, the organiser's laptop, an SSE
// stream per person and a poller all leave from the SAME NAT IP at the SAME
// time. A limiter keyed on IP alone would treat the whole table as one
// caller and lock the demo out of its own product — that failure mode is
// worse than the vulnerability it would be closing.
import rateLimit from '@fastify/rate-limit'
import type { FastifyInstance, FastifyRequest } from 'fastify'

/**
 * One bucket per device, not per IP.
 *
 * IP alone collapses a conference-wifi table (one NAT address) AND every
 * visitor of the deployed web app (its BFF proxies every /v1 call through
 * one Vercel egress IP, and forwards neither the caller's address nor their
 * User-Agent unless asked — see web/src/app/api/[...path]/route.ts). Pairing
 * the resolved IP with User-Agent splits real devices back apart without
 * requiring anyone to be signed in, which the product's bearer-link model
 * requires: a participant answering from their phone has no account and no
 * session to key on instead.
 *
 * This is not unbeatable — a script that rotates its User-Agent per request
 * evades it — but the audit's own reproduction (20 identical requests, same
 * client, same everything) is exactly what it stops, and a determined
 * attacker rotating headers is a materially different, larger problem than
 * "nothing was rate limited at all."
 */
export function rateLimitKey(req: FastifyRequest): string {
  const ua = String(req.headers['user-agent'] ?? 'no-ua').slice(0, 140)
  return `${req.ip}:${ua}`
}

/** Never gate liveness, and never gate a connection that is SUPPOSED to stay
 *  open. Railway's own health probe and every SSE stream (one per person in
 *  the demo, reconnecting on flaky wifi) must never see a 429. */
function isExempt(req: FastifyRequest): boolean {
  if (req.url === '/health') return true
  return String(req.headers.accept ?? '').includes('text/event-stream')
}

/**
 * The global default every route gets unless it opts into something
 * tighter with `spendLimit()` below. 300/minute per device comfortably
 * clears real polling load — the plan board and the participant page each
 * poll every 5-6s, so five people actively watching one plan is on the
 * order of 60 requests/minute, total, across ALL of them combined — while
 * still capping a runaway script at a small multiple of realistic traffic
 * rather than leaving it unbounded.
 */
export async function registerRateLimiting(app: FastifyInstance): Promise<void> {
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    keyGenerator: rateLimitKey,
    allowList: (req) => isExempt(req),
  })
}

/**
 * A tighter, route-specific ceiling — for the routes the audit named
 * explicitly: auth (brute force) and the routes that spend a third party's
 * quota on the caller's behalf (an LLM call, a geocoder, Overpass, a
 * merchant's search endpoint). Pass as the route's options object, e.g.
 * `app.post('/v1/auth/login', spendLimit(8), async (req) => {...})`.
 *
 * Every number chosen here is well above what ONE demo participant could
 * generate by hand in a minute (they log in once; they create a plan a
 * handful of times while rehearsing) and well below what an unthrottled
 * script could do — see rate-limit.test.ts for the reproduction this pins.
 */
export function spendLimit(max: number, timeWindow: string = '1 minute') {
  return { config: { rateLimit: { max, timeWindow } } }
}
