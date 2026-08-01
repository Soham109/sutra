import type { NextRequest } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ENGINE = process.env.ENGINE_URL ?? 'http://localhost:4100'
const ENGINE_TOKEN = process.env.ENGINE_API_TOKEN ?? (process.env.NODE_ENV === 'development' ? 'dev-token' : '')

/**
 * How long a given call is allowed to take, in milliseconds.
 *
 * Ordered most specific first. The numbers are what the slow path actually
 * costs, not a wish: the planner is a language-model call plus a Nominatim
 * geocode, the venue search is Overpass with its own 25s per-attempt budget
 * and a second endpoint to fall back to, and resolving a merchant link waits
 * on a stranger's web server.
 */
const BUDGETS: [RegExp, number][] = [
  [/^v1\/places\//, 50_000],           // Overpass: two endpoints, 40s total budget
  [/^v1\/plans\/[^/]+\/options/, 50_000],
  [/^v1\/agent\//, 40_000],            // model + geocode
  [/^v1\/bill\/(parse|photo)/, 40_000], // model transcription of a photo
  [/^v1\/discover\/compare/, 35_000],  // every storefront on the shelf
  [/^v1\/discover\//, 25_000],         // one merchant page, or one search
  [/^v1\/groups$/, 20_000],            // creating a group mints Prava sessions
  [/^v1\/members\/[^/]+\/(open|approve|accept)/, 20_000],
]

function budgetFor(path: string[]): number {
  const joined = path.join('/')
  return BUDGETS.find(([re]) => re.test(joined))?.[1] ?? 12_000
}

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params
  const target = new URL(path.join('/'), ENGINE.endsWith('/') ? ENGINE : `${ENGINE}/`)
  target.search = request.nextUrl.search
  const headers = new Headers()
  // x-forwarded-for and user-agent matter beyond passthrough: the engine's
  // rate limiter keys on them (see engine/src/rate-limit.ts) to tell real
  // devices apart. Without these this proxy is EVERY caller's address as far
  // as the engine can see — Vercel's own egress IP, no browser UA — which
  // would collapse every visitor of the deployed app into one bucket.
  // Rate-limit keys on IP. Prefer the platform's view of the client, never the
  // browser-supplied XFF (easy to rotate and bypass buckets).
  const realIp =
    request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    request.headers.get('cf-connecting-ip')
  if (realIp) headers.set('x-forwarded-for', realIp)
  const ua = request.headers.get('user-agent')
  if (ua) headers.set('user-agent', ua)
  for (const name of ['content-type', 'accept', 'cookie', 'last-event-id']) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }

  // CRITICAL: do NOT stamp ENGINE_API_TOKEN on every browser call.
  //
  // The engine treats that bearer as the operator: cancel any group, full plan
  // participant ids, skip chat membership checks. The Next app talks to the
  // engine only through this proxy, so injecting the token everywhere made
  // every visitor of sutra-gmp.vercel.app into an operator — undoing the
  // cancel-authority and plan-privacy fixes.
  //
  // Never stamp the operator token for browser traffic. Human creates use the
  // session cookie; the engine accepts cookie OR operator bearer on POST
  // /v1/groups. Injecting the master token here elevated every visitor and
  // let anonymous creates skip the friends-only gate.
  const clientAuth = request.headers.get('authorization')
  if (clientAuth && (!ENGINE_TOKEN || clientAuth !== `Bearer ${ENGINE_TOKEN}`)) {
    headers.set('authorization', clientAuth)
  }

  // An event stream is supposed to stay open. Everything else is not: without a
  // deadline here, a sleeping Railway container or bad conference wifi leaves
  // the browser spinning for the full 30-60s socket timeout, which reads as a
  // broken app rather than a slow one.
  //
  // But the budget cannot be one number. Reading a group is a SQLite lookup and
  // should never take seconds; planning a sentence calls a language model AND a
  // geocoder, and asking a merchant's page for its own product data waits on
  // somebody else's server. A flat 12s killed the planning flow — which is the
  // headline feature — with a timeout error on a request that was working fine.
  const isStream = (request.headers.get('accept') ?? '').includes('text/event-stream')
  const budget = isStream ? null : budgetFor(path)
  const deadline = budget ? AbortSignal.timeout(budget) : undefined

  let response: Response
  try {
    response = await fetch(target, {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer(),
      redirect: 'manual',
      cache: 'no-store',
      signal: deadline,
    })
  } catch (err) {
    // Say which of the two it was. "Timed out" and "refused" send the operator
    // to completely different places, and the browser cannot tell them apart.
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
    return Response.json(
      {
        error: timedOut ? 'engine_timeout' : 'engine_unreachable',
        // Read by a human in a red box, so it says what to do rather than
        // naming an internal state.
        message: timedOut
          ? `That took longer than ${Math.round((budget ?? 12_000) / 1000)} seconds and was given up on. Nothing was created — try again.`
          : 'Sutra’s server could not be reached from here. Check your connection and try again.',
      },
      { status: 504, headers: { 'cache-control': 'no-store' } },
    )
  }
  const outgoing = new Headers()
  for (const name of ['content-type', 'cache-control', 'location']) {
    const value = response.headers.get(name)
    if (value) outgoing.set(name, value)
  }
  // Signout (and some login paths) set multiple cookies. headers.get() joins
  // them with commas and breaks Set-Cookie parsing — append each one.
  const setCookies =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : response.headers.get('set-cookie')
        ? [response.headers.get('set-cookie')!]
        : []
  for (const cookie of setCookies) outgoing.append('set-cookie', cookie)
  return new Response(response.body, { status: response.status, headers: outgoing })
}

export const GET = proxy
export const POST = proxy
export const PUT = proxy
export const PATCH = proxy
export const DELETE = proxy
export const OPTIONS = proxy
