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
  const response = await fetch(target, {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer(),
    redirect: 'manual',
    cache: 'no-store',
  })
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
