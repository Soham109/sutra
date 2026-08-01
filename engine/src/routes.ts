// The GMP/1 engine API (spec §13). REST + SSE, zod-validated at the boundary.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import QRCode from 'qrcode'
import { CreateGroupSchema, GROUP_TERMINAL, type Cart, type EventRow, type GroupRow, type MemberRow } from './types.js'
import { UserError, type GroupService } from './service.js'
import { capabilityOf } from './rails.js'
import type { Poller } from './poller.js'
import { MockPrava } from './prava/mock.js'
import { spendLimit } from './rate-limit.js'
import { describePolicy, cartTotal, type Policy } from './types.js'

export interface RoutesConfig {
  apiToken: string
  appBaseUrl: string
  /**
   * Resolves the signed-in account behind a request, for the few core routes
   * that need to know who is asking. A function rather than the object itself
   * because the social layer is built after these routes are registered.
   */
  social?: { userFor: (req: { headers: Record<string, unknown> }) => { id: string } | undefined }
}

export function registerRoutes(
  app: FastifyInstance,
  service: GroupService,
  poller: Poller,
  cfg: RoutesConfig,
): void {
  // Action endpoints (open/decline/hold/…) take POSTs with empty bodies;
  // the default parser 400s on those. Tolerate emptiness, keep strict JSON.
  app.removeContentTypeParser('application/json')
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    if (!body || (typeof body === 'string' && body.trim() === '')) return done(null, {})
    try {
      done(null, JSON.parse(body as string))
    } catch (e) {
      done(e as Error)
    }
  })

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof UserError) return reply.status(err.statusCode).send({ error: err.message })
    if (err instanceof z.ZodError) return reply.status(400).send({ error: 'validation failed', details: err.issues })
    const status = (err as { statusCode?: number }).statusCode
    if (status && status >= 400 && status < 500) {
      return reply.status(status).send({ error: (err as Error).message })
    }
    app.log.error(err)
    return reply.status(500).send({ error: 'internal error' })
  })

  // CORS — the production frontend (Next.js on Vercel) is a separate origin.
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('access-control-allow-origin', '*')
    reply.header('access-control-allow-headers', 'authorization, content-type')
    reply.header('access-control-allow-methods', 'GET, POST, OPTIONS')
    return payload
  })
  app.options('/*', async (_req, reply) => reply.status(204).send())

  const requireToken = (req: FastifyRequest, reply: FastifyReply): boolean => {
    const auth = req.headers.authorization ?? ''
    if (auth !== `Bearer ${cfg.apiToken}`) {
      reply.status(401).send({ error: 'missing or invalid bearer token' })
      return false
    }
    return true
  }

  // -- create group ---------------------------------------------------------

  app.post('/v1/groups', async (req, reply) => {
    if (!requireToken(req, reply)) return
    const input = CreateGroupSchema.parse(req.body)
    const { group, members } = service.createGroup(input)
    return reply.status(201).send({
      group_id: group.id,
      board_url: `${cfg.appBaseUrl}/g/${group.id}/board`,
      members: members.map((m) => ({
        member_id: m.id,
        name: m.display_name,
        role: m.role,
        share_amount: m.share_amount,
        approval_page_url: `${cfg.appBaseUrl}/a/${m.id}`,
      })),
    })
  })

  // -- group state ----------------------------------------------------------

  app.get('/v1/groups/:id', async (req) => {
    const { id } = req.params as { id: string }
    return groupView(service, service.mustGroup(id))
  })

  /**
   * Calling off the whole thing is the organiser's decision alone.
   *
   * This used to trust the URL: a live probe cancelled a real group with no
   * cookie and no token, dropping every member, and the event log recorded it
   * as "organizer cancelled" — which was a lie, because the caller was
   * anonymous. A group link is shown on a screen at a table and encoded in a
   * QR anyone can photograph, so "holds the link" cannot mean "may destroy it".
   */
  app.post('/v1/groups/:id/cancel', async (req, reply) => {
    const { id } = req.params as { id: string }
    const g = service.mustGroup(id)
    const body = z.object({ as_member: z.string().optional() }).parse(req.body ?? {})

    const holdsToken = (req.headers.authorization ?? '') === `Bearer ${cfg.apiToken}`
    const viewer = cfg.social ? cfg.social.userFor(req as { headers: Record<string, unknown> }) : undefined
    const isOrganiser = !!g.created_by && viewer?.id === g.created_by

    // Not every group has an account behind it — one made from the widget or
    // the bookmarklet has no `created_by` at all. For those the organiser is
    // whoever set it up, which is the first member created, and the proof is
    // holding that member's own link. Anyone else's link will not do: on a
    // quorum policy a single decline does not abort, so letting any member
    // cancel would hand them power the policy deliberately withheld.
    const first = g.created_by ? null : service.db.membersOf(g.id)[0]
    const isFounder = !!first && !!body.as_member && body.as_member === first.id

    if (!holdsToken && !isOrganiser && !isFounder) {
      return reply.status(403).send({ error: 'only the person who started this group can call it off' })
    }
    await service.cancelGroup(id)
    return groupView(service, service.mustGroup(id))
  })

  app.get('/v1/groups/:id/receipt', async (req, reply) => {
    const { id } = req.params as { id: string }
    const receipt = service.db.getReceipt(id)
    if (!receipt) return reply.status(404).send({ error: 'no receipt yet — group is not terminal' })
    return reply.type('application/json').send(receipt)
  })

  app.get('/v1/groups/:id/events', async (req, reply) => {
    const { id } = req.params as { id: string }
    const after = Number((req.query as { after?: string }).after ?? 0)
    service.mustGroup(id)

    reply.hijack()
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'access-control-allow-origin': '*',
    })
    const send = (e: EventRow) => {
      reply.raw.write(`id: ${e.seq}\nevent: gmp\ndata: ${JSON.stringify(eventView(e))}\n\n`)
    }
    for (const e of service.db.eventsAfter(id, after)) send(e)
    const unsubscribe = service.hub.subscribe(id, send)
    const keepalive = setInterval(() => reply.raw.write(': ping\n\n'), 15000)
    req.raw.on('close', () => {
      clearInterval(keepalive)
      unsubscribe()
      reply.raw.end()
    })
  })

  // -- member surface -------------------------------------------------------

  app.get('/v1/members/:id', async (req) => {
    const { id } = req.params as { id: string }
    const m = service.mustMember(id)
    return memberView(service, m)
  })

  app.post('/v1/members/:id/open', async (req) => {
    const { id } = req.params as { id: string }
    const m = await service.openMember(id)
    return memberView(service, m)
  })

  app.post('/v1/members/:id/decline', async (req) => {
    const { id } = req.params as { id: string }
    await service.declineMember(id)
    return memberView(service, service.mustMember(id))
  })

  /**
   * at_venue rail only: the member reads their exact amount and accepts it.
   * Deliberately a different verb and a different endpoint from a mandate
   * approval — on this rail no card is charged, and the API must not let the
   * two acts be confused for one another.
   */
  app.post('/v1/members/:id/accept', async (req) => {
    const { id } = req.params as { id: string }
    await service.acceptShare(id)
    return memberView(service, service.mustMember(id))
  })

  app.post('/v1/members/:id/bid', async (req) => {
    const { id } = req.params as { id: string }
    const body = z.object({ sku: z.string(), amount: z.number().int().nonnegative() }).parse(req.body)
    service.placeBid(id, body.sku, body.amount)
    return memberView(service, service.mustMember(id))
  })

  app.post('/v1/members/:id/hold', async (req) => {
    const { id } = req.params as { id: string }
    await service.holdShare(id)
    return memberView(service, service.mustMember(id))
  })

  app.post('/v1/members/:id/resume', async (req) => {
    const { id } = req.params as { id: string }
    await service.resumeShare(id)
    return memberView(service, service.mustMember(id))
  })

  // Totem / shared-join flow (§21.2): one NDEF tag → this endpoint → pick
  // your name → your own approval page.
  app.get('/v1/groups/:id/joinable', async (req) => {
    const { id } = req.params as { id: string }
    const g = service.mustGroup(id)
    const view = groupView(service, g)
    return {
      group_id: view.group_id,
      title: view.title,
      status: view.status,
      merchant: view.merchant,
      total: view.total,
      currency: view.currency,
      deadline_at: view.deadline_at,
      policy_text: view.policy_text,
      terminal: view.terminal,
      members: view.members.map((m) => ({
        member_id: m.member_id,
        name: m.name,
        role: m.role,
        status: m.status,
        share_amount: m.share_amount,
        cap_amount: m.cap_amount,
        claimable: ['invited', 'viewed', 'awaiting_approval'].includes(m.status),
      })),
    }
  })

  app.get('/v1/members/:id/qr.png', async (req, reply) => {
    const { id } = req.params as { id: string }
    service.mustMember(id)
    const png = await QRCode.toBuffer(`${cfg.appBaseUrl}/a/${id}`, { width: 360, margin: 1 })
    return reply.type('image/png').send(png)
  })

  app.get('/v1/groups/:id/join-qr.png', async (req, reply) => {
    const { id } = req.params as { id: string }
    service.mustGroup(id)
    const png = await QRCode.toBuffer(`${cfg.appBaseUrl}/j/${id}`, { width: 480, margin: 1 })
    return reply.type('image/png').send(png)
  })

  // -- organizer agent: free text → group proposal --------------------------
  // Uses OpenAI when OPENAI_API_KEY is set; otherwise a deterministic parser
  // so the flow works offline. The proposal is an editable card — the human
  // always confirms before anything is created.

  // Spends an OpenAI call on the caller's behalf when a key is configured —
  // same "someone else's rate limit" concern as the plan layer's agent route.
  app.post('/v1/agent/propose', spendLimit(20), async (req) => {
    const body = z.object({ prompt: z.string().min(3).max(2000) }).parse(req.body)
    const key = process.env.OPENAI_API_KEY
    if (key) {
      try {
        return await proposeWithOpenAI(key, body.prompt)
      } catch {
        return proposeHeuristically(body.prompt)
      }
    }
    return proposeHeuristically(body.prompt)
  })

  // -- mock Prava hosted ceremony (offline demo only) -----------------------

  if (service.prava instanceof MockPrava) {
    const mock = service.prava

    app.get('/mock/pay/:sessionId', async (req, reply) => {
      const { sessionId } = req.params as { sessionId: string }
      const s = mock.getSession(sessionId)
      if (!s) return reply.status(404).type('text/html').send('<h1>Session not found</h1>')
      return reply.type('text/html').send(mockCeremonyHtml(s.id, s.merchantName, s.amount, s.currency))
    })

    app.post('/mock/pay/:sessionId/approve', async (req, reply) => {
      const { sessionId } = req.params as { sessionId: string }
      const ok = mock.approveSession(sessionId)
      if (ok) await poller.tick() // make the flip land instantly, no 1.5s wait
      const s = mock.getSession(sessionId)
      return reply.send({ ok, redirect: s?.callbackUrl ?? null })
    })

    // chaos/demo hook: force the next charge for a member to be declined
    app.post('/mock/decline-next-charge/:memberId', async (req) => {
      const { memberId } = req.params as { memberId: string }
      mock.declineNextChargeFor(memberId)
      return { ok: true }
    })
  }
}

// ---------------------------------------------------------------------------
// View models — no raw rows over the wire
// ---------------------------------------------------------------------------

export function groupView(service: GroupService, g: GroupRow) {
  const cart = JSON.parse(g.cart_json) as Cart
  const policy = JSON.parse(g.policy_json) as Policy
  const members = service.db.membersOf(g.id)
  const lastEvent = service.db.eventsAfter(g.id, 0).at(-1)
  return {
    auction: g.auction_close_at
      ? { closes_at: g.auction_close_at, open: service.auctionOpen(g) }
      : null,
    fx: g.fx_json ? JSON.parse(g.fx_json) : null,
    group_id: g.id,
    title: g.title,
    status: g.status,
    merchant: JSON.parse(g.merchant_json),
    cart,
    cart_hash: g.cart_hash,
    total: cartTotal(cart),
    currency: g.currency,
    policy,
    policy_text: describePolicy(policy),
    tolerance_bps: g.tolerance_bps,
    straggler_policy: g.straggler_policy,
    no_blame: !!g.no_blame,
    rail: g.rail,
    rail_capability: capabilityOf(g.rail),
    origin: g.origin,
    // The organizer is the one person no-blame mode does not hide declines
    // from — the surfaces need this to make that call.
    created_by: g.created_by,
    circle_id: g.circle_id,
    product: g.product_json ? JSON.parse(g.product_json) : null,
    deadline_at: g.deadline_at,
    decision_note: g.decision_note,
    terminal: GROUP_TERMINAL.has(g.status),
    event_cursor: lastEvent?.seq ?? 0,
    members: members.map((m) => ({
      member_id: m.id,
      name: m.display_name,
      role: m.role,
      status: m.status,
      share_amount: m.share_amount,
      cap_amount: m.cap_amount,
      backstop_cap: m.backstop_cap,
      backstop_armed: !!m.backstop_mandate_id,
      backstop_absorbed: m.backstop_absorbed,
      charged_amount: m.charged_amount,
      requote_round: m.requote_round,
      on_hold: !!m.on_hold,
    })),
  }
}

export function memberView(service: GroupService, m: MemberRow) {
  const g = service.mustGroup(m.group_id)
  const cart = JSON.parse(g.cart_json) as Cart
  const policy = JSON.parse(g.policy_json) as Policy
  const items = cart.items.filter(
    (i) => i.claimants.includes('mi_all') || i.claimants.includes(m.display_name),
  )
  const contested = cart.items.filter((i) => i.contested && i.claimants.includes(m.display_name))
  const myBids = service.db.myBids(g.id, m.id)
  return {
    member_id: m.id,
    group_id: g.id,
    name: m.display_name,
    role: m.role,
    status: m.status,
    on_hold: !!m.on_hold,
    share_amount: m.share_amount,
    cap_amount: m.cap_amount,
    backstop_cap: m.backstop_cap,
    backstop_armed: !!m.backstop_mandate_id,
    backstop_approval_url: m.backstop_approval_url,
    approval_url: m.prava_approval_url,
    requote_round: m.requote_round,
    charged_amount: m.charged_amount,
    auction: g.auction_close_at
      ? {
          open: service.auctionOpen(g),
          closes_at: g.auction_close_at,
          contested_items: contested.map((i) => ({
            sku: i.sku,
            name: i.name,
            slots: i.qty,
            claimants: i.claimants.length,
            my_bid: myBids.filter((b) => b.sku === i.sku).at(-1)?.amount ?? null,
          })),
        }
      : null,
    fx: g.fx_json ? JSON.parse(g.fx_json) : null,
    // Which rail carries this, and the sentence the member must see BEFORE
    // they commit to anything. On at_venue there is no card ceremony and no
    // charge, and the approval page has to say so in its own words rather than
    // inheriting the mandate rail's language.
    rail: g.rail,
    rail_capability: capabilityOf(g.rail),
    action: capabilityOf(g.rail).mandates ? 'approve' : 'accept',
    group: {
      title: g.title,
      status: g.status,
      merchant: JSON.parse(g.merchant_json),
      currency: g.currency,
      total: cartTotal(cart),
      policy_text: describePolicy(policy),
      deadline_at: g.deadline_at,
      no_blame: !!g.no_blame,
      terminal: GROUP_TERMINAL.has(g.status),
      rail: g.rail,
    },
    my_items: items,
  }
}

function eventView(e: EventRow) {
  return {
    seq: e.seq,
    group_id: e.group_id,
    member_id: e.member_id,
    type: e.type,
    payload: JSON.parse(e.payload_json),
    at: e.created_at,
  }
}

// ---------------------------------------------------------------------------

function mockCeremonyHtml(sessionId: string, merchant: string, amount: string, currency: string): string {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Prava — approve mandate</title><style>
  body{font-family:system-ui,sans-serif;background:#0b0e14;color:#e6e9f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
  .card{background:#141926;border:1px solid #232b3d;border-radius:16px;padding:28px;max-width:360px;width:90%}
  .tag{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#7d8598}
  h1{font-size:20px;margin:.4em 0}
  .amount{font-size:34px;font-weight:700;margin:12px 0}
  .guard{font-size:13px;color:#9aa3b5;line-height:1.5;border-left:3px solid #3b82f6;padding-left:10px;margin:16px 0}
  button{width:100%;padding:14px;border-radius:10px;border:0;font-size:16px;font-weight:600;cursor:pointer}
  .approve{background:#3b82f6;color:#fff}
  .done{color:#4ade80;text-align:center;font-size:18px;padding:20px 0}
  .sim{margin-top:14px;text-align:center;font-size:11px;color:#565e70}
</style></head><body><div class="card">
  <div class="tag">Prava simulator · mandate setup</div>
  <h1>${escapeHtml(merchant)}</h1>
  <div class="amount">${escapeHtml(currency)} ${escapeHtml(amount)}</div>
  <div class="guard">Locked to <b>${escapeHtml(merchant)}</b> · capped at <b>${escapeHtml(currency)} ${escapeHtml(amount)}</b> · one-time · expires in 7 days. Caps are enforced at the card network, not by the app asking you.</div>
  <div id="act"><button class="approve" onclick="approve()">&#128273; Approve with passkey</button></div>
  <div class="sim">Simulated hosted ceremony — in sandbox this is Prava's real page + OTP 456789</div>
</div><script>
async function approve(){
  const r = await fetch('/mock/pay/${sessionId}/approve', {method:'POST'});
  const d = await r.json();
  document.getElementById('act').innerHTML = '<div class="done">&#10003; Mandate active</div>';
  if (d.redirect) setTimeout(()=>location.href=d.redirect, 700);
}
</script></body></html>`
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

// ---------------------------------------------------------------------------
// Organizer agent
// ---------------------------------------------------------------------------

interface Proposal {
  title: string
  merchant_name: string
  items: { name: string; unit_amount: number; qty: number }[]
  members: string[]
  policy_hint: 'all_of' | 'quorum' | 'deadline'
  source: 'openai' | 'heuristic'
}

async function proposeWithOpenAI(key: string, prompt: string): Promise<Proposal> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? 'gpt-4.1-nano',
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'Turn a group-purchase request into strict JSON: {"title":string,"merchant_name":string,' +
            '"items":[{"name":string,"unit_amount":int_minor_units,"qty":int}],"members":[string],' +
            '"policy_hint":"all_of"|"quorum"|"deadline"}. unit_amount is in cents. ' +
            'Prefer "deadline" when the request mentions time pressure, "quorum" when partial attendance is fine.',
        },
        { role: 'user', content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`openai ${res.status}`)
  const data = (await res.json()) as { choices: { message: { content: string } }[] }
  const parsed = JSON.parse(data.choices[0]!.message.content) as Omit<Proposal, 'source'>
  return { ...parsed, source: 'openai' }
}

/** Zero-network fallback so the organizer flow works offline. */
function proposeHeuristically(prompt: string): Proposal {
  const price = /\$?(\d+(?:\.\d{1,2})?)\s*(?:each|per|\/|dollars|bucks|usd)?/i.exec(prompt)
  const count = /(\d+)\s*(?:tickets|seats|people|of us|friends|members)/i.exec(prompt)
  const names = [...prompt.matchAll(/\b([A-Z][a-z]{2,12})\b/g)]
    .map((m) => m[1]!)
    .filter((n) => !['The', 'And', 'For', 'With', 'Get', 'Buy', 'Our', 'Everyone'].includes(n))
  const n = count ? Number(count[1]) : Math.max(names.length, 2)
  const unit = price ? Math.round(Number(price[1]) * 100) : 4500
  return {
    title: prompt.slice(0, 60),
    merchant_name: 'Velvet Ticket Co.',
    items: [{ name: 'Ticket', unit_amount: unit, qty: n }],
    members: names.length >= 2 ? names.slice(0, n) : Array.from({ length: n }, (_, i) => `Member ${i + 1}`),
    policy_hint: /everyone|all of us|no one left/i.test(prompt) ? 'all_of' : /whoever|at least|any/i.test(prompt) ? 'quorum' : 'deadline',
    source: 'heuristic',
  }
}
