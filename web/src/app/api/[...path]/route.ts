import type { NextRequest } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ENGINE = process.env.ENGINE_URL ?? 'http://localhost:4100'
const ENGINE_TOKEN = process.env.ENGINE_API_TOKEN ?? (process.env.NODE_ENV === 'development' ? 'dev-token' : '')

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params
  const target = new URL(path.join('/'), ENGINE.endsWith('/') ? ENGINE : `${ENGINE}/`)
  target.search = request.nextUrl.search
  const headers = new Headers()
  for (const name of ['content-type', 'accept', 'cookie', 'last-event-id']) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }
  if (ENGINE_TOKEN) headers.set('authorization', `Bearer ${ENGINE_TOKEN}`)

  // An event stream is supposed to stay open. Everything else is not: without a
  // deadline here, a sleeping Railway container or bad conference wifi leaves
  // the browser spinning for the full 30-60s socket timeout, which reads as a
  // broken app rather than a slow one. Fail fast enough to say something.
  const isStream = (request.headers.get('accept') ?? '').includes('text/event-stream')
  const deadline = isStream ? undefined : AbortSignal.timeout(12_000)

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
        message: timedOut
          ? 'Sutra’s server did not answer within 12 seconds. It may be waking up — try again.'
          : 'Sutra’s server could not be reached from here.',
      },
      { status: 504, headers: { 'cache-control': 'no-store' } },
    )
  }
  const outgoing = new Headers()
  for (const name of ['content-type', 'cache-control', 'location', 'set-cookie']) {
    const value = response.headers.get(name)
    if (value) outgoing.set(name, value)
  }
  return new Response(response.body, { status: response.status, headers: outgoing })
}

export const GET = proxy
export const POST = proxy
export const PUT = proxy
export const PATCH = proxy
export const DELETE = proxy
export const OPTIONS = proxy
