#!/usr/bin/env tsx
/**
 * Does signing in actually work, end to end, against a deployed engine?
 *
 *   GMP_API=https://engine-production-e6fa.up.railway.app npx tsx e2e/auth-check.ts
 *
 * Registers a throwaway account, follows the session cookie, and reads a
 * protected route with it. Written because "login is broken" turned out to
 * mean "the engine was running last week's build" — a check that fails loudly
 * is cheaper than finding that out from a person trying to use the product.
 */
const API = process.env.GMP_API ?? 'http://localhost:4100'

const email = `probe+${Date.now()}@sutra.test`
const password = 'a-long-enough-passphrase'
const handle = `probe${Date.now().toString().slice(-6)}`

function cookieFrom(res: Response): string {
  const raw = res.headers.getSetCookie?.() ?? []
  return raw.map((c) => c.split(';')[0]).join('; ')
}

async function main() {
  let pass = 0
  let fail = 0
  const ok = (label: string, good: boolean, detail = '') => {
    console.log(`  ${good ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${label}${detail ? ` — ${detail}` : ''}`)
    good ? pass++ : fail++
  }

  console.log(`\nengine ${API}\n`)

  const reg = await fetch(`${API}/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, handle, name: 'Probe User' }),
  })
  const regBody = await reg.json().catch(() => ({}))
  ok('register returns 200', reg.ok, reg.ok ? '' : `${reg.status} ${JSON.stringify(regBody).slice(0, 120)}`)

  const cookie = cookieFrom(reg)
  ok('register sets a session cookie', cookie.includes('sutra_session'))

  const me = await fetch(`${API}/v1/me`, { headers: { cookie } })
  const meBody = (await me.json().catch(() => ({}))) as { user?: { handle?: string } }
  ok('the cookie authenticates /v1/me', me.ok && meBody.user?.handle === handle)

  const anon = await fetch(`${API}/v1/me`)
  ok('without a cookie /v1/me is 401', anon.status === 401)

  const login = await fetch(`${API}/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  ok('login with the right password', login.ok)
  ok('login issues a session too', cookieFrom(login).includes('sutra_session'))

  const bad = await fetch(`${API}/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'wrong-password-entirely' }),
  })
  ok('a wrong password is rejected', bad.status === 401)

  const dash = await fetch(`${API}/v1/my/dashboard`, { headers: { cookie } })
  ok('a protected route works with the session', dash.ok, dash.ok ? '' : String(dash.status))

  console.log(`\n  ${pass} passed, ${fail} failed\n`)
  if (fail > 0) process.exit(1)
}

main().catch((e) => {
  console.error(`\n\x1b[31m✗ ${(e as Error).message}\x1b[0m\n`)
  process.exit(1)
})
