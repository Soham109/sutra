// Discovery + social routes. Kept beside the protocol routes rather than
// inside them: /v1/groups is the frozen GMP/1 contract other apps integrate
// against, and this surface is the product built on top of it.
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { Catalog } from './catalog/index.js'
import { compareOffers } from './catalog/compare.js'
import { billToCart, parseBill } from './bill/index.js'
import { inferBillCurrency } from './bill/currency.js'
import { checkOcrIntegrity } from './bill/integrity.js'
import type { PlanStore } from './plan/store.js'
import { capabilityOf } from './rails.js'
import { UserError, type GroupService } from './service.js'
import { Social, publicUser, type User } from './social.js'
import { groupView } from './routes.js'
import { spendLimit } from './rate-limit.js'
import { cartTotal, CreateGroupSchema, GROUP_TERMINAL, type Cart } from './types.js'

const USER_COOKIE = 'sutra_uid'
const SESSION_COOKIE = 'sutra_session'

/**
 * Who is asking. Deliberately lightweight: a handle picks who you are, stored
 * in a cookie. Nothing here grants spending power — spending still needs the
 * member's own passkey on Prava's own page — so the weakest link in this
 * identity scheme cannot cost anyone money.
 */
export function currentUserFrom(
  social: Social,
  req: { headers: Record<string, unknown> },
): User | undefined {
  const raw = String(req.headers['cookie'] ?? '')
  const sessionMatch = new RegExp(`${SESSION_COOKIE}=([^;]+)`).exec(raw)
  if (sessionMatch?.[1]) {
    const user = social.userForSession(decodeURIComponent(sessionMatch[1]))
    if (user) return user
  }
  const m = new RegExp(`${USER_COOKIE}=([^;]+)`).exec(raw)
  const headerId = String(req.headers['x-sutra-user'] ?? '')
  const id = headerId || (m?.[1] ? decodeURIComponent(m[1]) : '')
  if (id && (process.env.NODE_ENV !== 'production' || process.env.ALLOW_DEV_AUTH === 'true')) return social.byId(id)
  const auth = String(req.headers['authorization'] ?? '')
  return auth.startsWith('Bearer ') ? social.userForSession(auth.slice(7)) : undefined
}

export function registerProductRoutes(
  app: FastifyInstance,
  service: GroupService,
  social: Social,
  catalog: Catalog,
  planStore: PlanStore,
  notifier?: { notify: (userId: string, input: { kind: string; title: string; body?: string; url?: string }) => unknown },
): void {
  // ---- identity ----------------------------------------------------------
  // Deliberately lightweight: a handle picks who you are, stored in a cookie.
  // Real auth is a day-two problem; nothing here grants spending power, and
  // spending still requires the member's own passkey on Prava's page.

  const currentUser = (req: { headers: Record<string, unknown> }): User | undefined =>
    currentUserFrom(social, req)

  const requireUser = (req: { headers: Record<string, unknown> }): User => {
    const u = currentUser(req)
    if (!u) throw new UserError('sign in to continue', 401)
    return u
  }

  const sessionCookie = (token: string, maxAge = 60 * 60 * 24 * 90) =>
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`

  // Registration and login are the brute-force surface: a live probe fired 20
  // back-to-back failed logins in 16 seconds and got 20 clean 401s, nothing
  // slowing it down. `spendLimit` keys on IP+User-Agent (rate-limit.ts), so
  // this stays per-device rather than per-conference-wifi — one real person
  // logging in, even fumbling a password a few times, never gets near it.
  app.post('/v1/auth/register', spendLimit(5), async (req, reply) => {
    const body = z.object({
      email: z.string().email().max(254),
      password: z.string().min(10).max(128),
      handle: z.string().min(2).max(30),
      name: z.string().min(1).max(60),
    }).parse(req.body)
    let user: User
    try { user = social.registerUser(body) }
    catch (error) { throw new UserError((error as Error).message, 409) }
    const session = social.createSession(user.id, 'web')
    reply.header('set-cookie', sessionCookie(session.token))
    return { user, reliability: social.reliability(user.id) }
  })

  app.post('/v1/auth/login', spendLimit(8), async (req, reply) => {
    const body = z.object({ email: z.string().email(), password: z.string().min(1).max(128) }).parse(req.body)
    const user = social.authenticate(body.email, body.password)
    if (!user) throw new UserError('email or password is incorrect', 401)
    const session = social.createSession(user.id, 'web')
    reply.header('set-cookie', sessionCookie(session.token))
    return { user, reliability: social.reliability(user.id) }
  })

  app.post('/v1/me', async (req, reply) => {
    if (process.env.ALLOW_DEV_AUTH !== 'true' && process.env.NODE_ENV === 'production') {
      throw new UserError('handle-only sign-in is disabled', 404)
    }
    const body = z
      .object({ handle: z.string().min(1).max(30), name: z.string().max(60).optional(), email: z.string().email().optional() })
      .parse(req.body)
    const user = social.createUser({
      handle: body.handle,
      name: body.name ?? body.handle,
      email: body.email,
    })
    reply.header(
      'set-cookie',
      `${USER_COOKIE}=${encodeURIComponent(user.id)}; Path=/; Max-Age=2592000; SameSite=Lax`,
    )
    return { user, reliability: social.reliability(user.id) }
  })

  app.get('/v1/me', async (req, reply) => {
    const user = currentUser(req)
    if (!user) return reply.status(401).send({ error: 'not signed in' })
    return {
      user,
      reliability: social.reliability(user.id),
      friends: social.friendsOf(user.id).map(publicUser),
      circles: social.circlesFor(user.id),
      // Real evidence, not a guess: friend ids in the order you most recently
      // shared a group with them, so a picker can put them first instead of
      // making everyone hunt A→Z for whoever they split with last night.
      recent_with: social.recentCollaborators(user.id),
    }
  })

  app.post('/v1/me/signout', async (_req, reply) => {
    reply.header('set-cookie', [
      `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`,
      `${USER_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`,
    ])
    return { ok: true }
  })

  app.post('/v1/me/extension-token', async (req) => {
    const me = requireUser(req)
    return social.createSession(me.id, 'browser extension')
  })

  app.post('/v1/me/extension-token/revoke', async (req) => {
    const me = requireUser(req)
    return { revoked: social.revokeSessions(me.id, 'browser extension') }
  })

  /** Product/BFF group creation for a signed-in companion client. */
  app.post('/v1/extension/groups', async (req, reply) => {
    const me = requireUser(req)
    const input = CreateGroupSchema.parse(req.body)
    social.assertLinkedFriends(me.id, input.members)
    const members = input.members
    const created = service.createGroup({ ...input, members, created_by: me.id, origin: 'extension' })
    // Absolute, like /v1/groups already returns. These URLs are rendered into
    // the MERCHANT'S page by the extension's on-page sheet, so a relative path
    // resolves against amazon.com rather than against sutra — the two primary
    // click targets at the payoff moment both 404 on somebody else's site.
    const base = service.cfg.appBaseUrl.replace(/\/$/, '')
    return reply.status(201).send({
      group_id: created.group.id,
      board_url: `${base}/g/${created.group.id}/board`,
      members: created.members.map((member) => ({
        member_id: member.id,
        name: member.display_name,
        role: member.role,
        share_amount: member.share_amount,
        approval_page_url: `${base}/a/${member.id}`,
      })),
    })
  })

  // ---- people ------------------------------------------------------------

  /**
   * The directory. Public by design — you have to be able to find a friend by
   * name — but it returns a display identity only. It used to spread the raw
   * database row, which put every user's email, and eventually their password
   * hash, in front of anybody who asked.
   */
  app.get('/v1/people', async (req) => {
    const q = String((req.query as { q?: string }).q ?? '').toLowerCase()
    const me = currentUser(req)
    const friendIds = new Set(me ? social.friendsOf(me.id).map((f) => f.id) : [])
    const outgoing = new Set(me ? social.outgoingRequests(me.id).map((r) => r.id) : [])
    const incoming = new Set(me ? social.incomingRequests(me.id).map((r) => r.id) : [])
    return {
      people: social
        .allUsers()
        .filter((u) => !q || u.name.toLowerCase().includes(q) || u.handle.includes(q))
        .map((u) => ({
          ...publicUser(u),
          is_friend: friendIds.has(u.id),
          is_me: u.id === me?.id,
          request_sent: outgoing.has(u.id),
          request_received: incoming.has(u.id),
        })),
    }
  })

  /** Ask to be someone's friend. They have to say yes. */
  app.post('/v1/people/:id/friend', async (req) => {
    const me = requireUser(req)
    const { id } = req.params as { id: string }
    if (!social.byId(id)) throw new UserError('no such person', 404)
    const state = social.requestFriend(me.id, id)
    if (state === 'requested') {
      notifier?.notify(id, {
        kind: 'friend.requested',
        title: `${me.name} wants to be friends`,
        body: 'Accept on People so they can put you on a split.',
        url: '/app/people',
      })
    } else if (state === 'friends') {
      notifier?.notify(id, {
        kind: 'friend.accepted',
        title: `You and ${me.name} are friends`,
        body: 'You can sit together on the next split.',
        url: '/app/people',
      })
    }
    return {
      state,
      friends: social.friendsOf(me.id).map(publicUser),
      outgoing: social.outgoingRequests(me.id).map(publicUser),
    }
  })

  app.get('/v1/people/requests', async (req) => {
    const me = requireUser(req)
    return {
      incoming: social.incomingRequests(me.id).map(publicUser),
      outgoing: social.outgoingRequests(me.id).map(publicUser),
    }
  })

  app.post('/v1/people/:id/accept', async (req) => {
    const me = requireUser(req)
    const { id } = req.params as { id: string }
    if (!social.acceptFriend(me.id, id)) throw new UserError('no pending request from that person', 404)
    notifier?.notify(id, {
      kind: 'friend.accepted',
      title: `${me.name} accepted your friend request`,
      body: 'You can sit together on the next split.',
      url: '/app/people',
    })
    return {
      friends: social.friendsOf(me.id).map(publicUser),
      incoming: social.incomingRequests(me.id).map(publicUser),
    }
  })

  app.post('/v1/people/:id/decline', async (req) => {
    const me = requireUser(req)
    const { id } = req.params as { id: string }
    social.declineFriend(me.id, id)
    return { incoming: social.incomingRequests(me.id).map(publicUser) }
  })

  app.post('/v1/people/:id/unfriend', async (req) => {
    const me = requireUser(req)
    const { id } = req.params as { id: string }
    social.removeFriend(me.id, id)
    return { friends: social.friendsOf(me.id).map(publicUser) }
  })

  app.get('/v1/people/:id/reliability', async (req) => {
    const { id } = req.params as { id: string }
    const user = social.byId(id)
    if (!user) throw new UserError('no such person', 404)
    return { user: publicUser(user), reliability: social.reliability(id) }
  })

  // ---- circles -----------------------------------------------------------

  app.get('/v1/circles', async (req) => {
    const me = requireUser(req)
    return { circles: social.circlesFor(me.id) }
  })

  app.post('/v1/circles', async (req) => {
    const me = requireUser(req)
    const body = z
      .object({
        name: z.string().min(1).max(60),
        emoji: z.string().max(8).optional(),
        member_ids: z.array(z.string()).default([]),
      })
      .parse(req.body)
    const circle = social.createCircle({
      ownerId: me.id,
      name: body.name,
      emoji: body.emoji,
      memberIds: body.member_ids,
    })
    return { circle: { ...circle, members: social.circleMembers(circle.id).map(publicUser) } }
  })

  app.post('/v1/circles/:id/delete', async (req) => {
    const me = requireUser(req)
    const { id } = req.params as { id: string }
    social.deleteCircle(id, me.id)
    return { circles: social.circlesFor(me.id) }
  })

  // ---- my groups ---------------------------------------------------------

  app.get('/v1/my/groups', async (req) => {
    const me = requireUser(req)
    const ids = social.groupsFor(me.id)
    return {
      groups: ids
        .map((id) => service.db.getGroup(id))
        .filter((g): g is NonNullable<typeof g> => !!g)
        .map((g) => groupView(service, g)),
    }
  })

  // ---- the dashboard -----------------------------------------------------
  //
  // Computed here rather than in the browser so every surface — web, the app
  // we build next, an agent asking on your behalf — reads the same numbers.
  // The question it answers is deliberately narrow: what needs me, and what is
  // my money currently exposed to.

  app.get('/v1/my/dashboard', async (req) => {
    const me = requireUser(req)
    const groups = social
      .groupsFor(me.id)
      .map((id) => service.db.getGroup(id))
      .filter((g): g is NonNullable<typeof g> => !!g)

    const needsYou: unknown[] = []
    const waitingOnOthers: unknown[] = []
    const recent: unknown[] = []
    // Exposure is per-currency: adding rupees to dollars would be the kind of
    // confident nonsense this product exists to avoid.
    const exposure = new Map<string, {
      authorized: number
      charging: number
      settled: number
      backstop_armed: number
      owed_at_venue: number
    }>()
    const bump = (cur: string, k: keyof NonNullable<ReturnType<typeof exposure.get>>, n: number) => {
      const e = exposure.get(cur) ?? {
        authorized: 0, charging: 0, settled: 0, backstop_armed: 0, owed_at_venue: 0,
      }
      e[k] += n
      exposure.set(cur, e)
    }

    for (const g of groups) {
      const members = service.db.membersOf(g.id)
      const mine = members.find((m) => m.user_id === me.id)
      const cap = capabilityOf(g.rail)

      if (mine) {
        // Money that could still leave my card without me touching anything
        // again — the number nobody else shows you.
        if (mine.status === 'approved') bump(g.currency, 'authorized', mine.cap_amount)
        if (mine.status === 'charging') bump(g.currency, 'charging', mine.share_amount)
        if (mine.status === 'charged') bump(g.currency, 'settled', mine.charged_amount)
        if (mine.status === 'settled') bump(g.currency, 'owed_at_venue', mine.share_amount)
        // A standing offer to cover someone else is exposure too, and it is
        // the one people forget they made.
        if (mine.backstop_mandate_id && mine.backstop_absorbed === 0 && !GROUP_TERMINAL.has(g.status)) {
          bump(g.currency, 'backstop_armed', mine.backstop_cap)
        }

        const actionable = ['invited', 'viewed', 'awaiting_approval'].includes(mine.status)
        if (actionable && !GROUP_TERMINAL.has(g.status)) {
          needsYou.push({
            kind: 'approval',
            member_id: mine.id,
            group_id: g.id,
            title: g.title,
            merchant: JSON.parse(g.merchant_json),
            share_amount: mine.share_amount,
            cap_amount: mine.cap_amount,
            currency: g.currency,
            deadline_at: g.deadline_at,
            status: mine.status,
            rail: g.rail,
            /** on at_venue there is no card ceremony — the action is different */
            action: cap.mandates ? 'approve' : 'accept',
            approval_url: mine.prava_approval_url,
          })
        }
      }

      if (GROUP_TERMINAL.has(g.status)) {
        recent.push({
          group_id: g.id,
          title: g.title,
          status: g.status,
          rail: g.rail,
          currency: g.currency,
          charged: members.reduce((s, m) => s + m.charged_amount, 0),
          your_amount: mine?.charged_amount || mine?.share_amount || 0,
          at: g.created_at,
        })
        continue
      }

      // Who the group is still waiting on — you excluded. Your own outstanding
      // approval is already the first thing on the page, and listing yourself
      // as someone you are waiting on reads as a bug.
      const pending = members.filter(
        (m) =>
          m.role !== 'observer' &&
          m.id !== mine?.id &&
          ['invited', 'viewed', 'awaiting_approval'].includes(m.status),
      )
      if (pending.length > 0) {
        const isOrganizer = g.created_by === me.id
        waitingOnOthers.push({
          group_id: g.id,
          title: g.title,
          currency: g.currency,
          total: cartTotal(JSON.parse(g.cart_json) as Cart),
          deadline_at: g.deadline_at,
          status: g.status,
          rail: g.rail,
          you_organized: isOrganizer,
          approved_count: members.filter((m) => m.status === 'approved').length,
          paying_count: members.filter((m) => m.role !== 'observer').length,
          waiting: g.no_blame && !isOrganizer
            ? pending.map(() => ({ name: null, status: null }))
            : pending.map((m) => ({ name: m.display_name, status: m.status })),
        })
      }
    }

    // Coordination that has not become a cart yet.
    const myPlans = planStore.plansFor(me.id)
    const planNeedsYou: unknown[] = []
    const livePlans: unknown[] = []
    for (const p of myPlans) {
      if (['converted', 'cancelled', 'expired'].includes(p.status)) continue
      const seat = planStore.participantForUser(p.id, me.id)
      const answered = new Set(
        planStore
          .currentSignals(p.id)
          .filter((s) => s.participant_id === seat?.id)
          .map((s) => s.kind),
      )
      const asked = (JSON.parse(p.ask_json) as string[]).filter((k) => !answered.has(k as never))
      const participants = planStore.participants(p.id)
      const view = {
        plan_id: p.id,
        participant_id: seat?.id ?? null,
        title: p.title,
        status: p.status,
        asked,
        deadline_at: p.deadline_at,
        responded_count: participants.filter((x) => x.responded_at).length,
        participant_count: participants.length,
        option_count: planStore.options(p.id).length,
      }
      if (seat && asked.length > 0) planNeedsYou.push(view)
      else livePlans.push(view)
    }

    return {
      user: me,
      reliability: social.reliability(me.id),
      needs_you: needsYou,
      plans_needing_you: planNeedsYou,
      waiting_on_others: waitingOnOthers,
      live_plans: livePlans,
      recent: recent.slice(0, 6),
      exposure: [...exposure.entries()].map(([currency, e]) => ({ currency, ...e })),
    }
  })

  // ---- bills -------------------------------------------------------------
  //
  // The "we are sitting in a restaurant and the bill just arrived" path. The
  // parse is deterministic and reconciles against the printed total, so the
  // group argues with the receipt rather than with us. A bill has no merchant
  // Prava can charge, so this lands on the at_venue rail: exact allocation,
  // explicit acceptance, signed record — and no claim that a card was charged.

  // Bill parsing spends OCR/vision work on the caller's behalf — see
  // routes-plan.ts's note on /v1/plans/:id/options/refresh for the same
  // "someone else's rate limit" concern.
  app.post('/v1/bill/parse', spendLimit(15), async (req) => {
    const body = z
      .object({
        text: z.string().max(20_000).optional(),
        image_base64: z.string().max(12_000_000).optional(),
        currency: z.string().length(3).optional(),
      })
      .parse(req.body)
    if (!body.text && !body.image_base64) throw new UserError('send bill text or an image')
    const guess = body.currency ? null : inferBillCurrency(body.text ?? '')
    const parsed = await parseBill(
      { text: body.text, image_base64: body.image_base64 },
      { currency: body.currency ?? guess?.currency ?? undefined },
    )
    // A currency read off the tax regime rather than a symbol is a judgement,
    // so it is surfaced rather than silently applied.
    if (guess?.basis === 'tax_regime' && guess.why) {
      parsed.warnings = [...parsed.warnings, guess.why]
    }
    // A balanced reconciliation is not proof of a correct read when the OCR
    // tore the decimals off into their own column — see bill/integrity.ts.
    const integrity = checkOcrIntegrity(parsed)
    if (integrity.suspect) parsed.warnings = [integrity.warning, ...parsed.warnings]
    return { ...parsed, integrity }
  })

  /** A parsed bill plus who claimed what → a real group on the at_venue rail. */
  app.post('/v1/bill/split', spendLimit(15), async (req, reply) => {
    const me = currentUser(req)
    const body = z
      .object({
        title: z.string().min(1).max(140).default('Split the bill'),
        venue: z.string().min(1).max(120).default('The table'),
        text: z.string().max(20_000).optional(),
        image_base64: z.string().max(12_000_000).optional(),
        /** parallel to bill.items: the names claiming each line */
        claimants: z.array(z.array(z.string())).optional(),
        members: z
          .array(z.object({ name: z.string().min(1).max(60), user_id: z.string().optional() }))
          .min(1)
          .max(30),
        policy: z.unknown().optional(),
        deadline_minutes: z.number().int().positive().default(180),
        no_blame: z.boolean().default(false),
        /** proceed despite a suspected fractured-decimal OCR read */
        force: z.boolean().default(false),
      })
      .parse(req.body)

    const bill = await parseBill(
      { text: body.text, image_base64: body.image_base64 },
      { currency: inferBillCurrency(body.text ?? '').currency ?? undefined },
    )
    // Refuse outright rather than warn: past this point people are asked to
    // agree to an exact number, and a fractured decimal read produces amounts
    // that are individually wrong while adding up perfectly. `force` exists so
    // a human who has checked the figures against the paper can still proceed.
    const integrity = checkOcrIntegrity(bill)
    if (integrity.suspect && !body.force) {
      throw new UserError(`${integrity.warning} Correct the lines and try again.`)
    }

    const cart = billToCart(bill, { claimantsByItemIndex: body.claimants })

    if (!me) throw new UserError('sign in to continue', 401)
    social.assertLinkedFriends(me.id, body.members)

    const { group, members } = service.createGroup({
      title: body.title,
      // Deliberately not a URL we could pass off as a merchant: railFor() reads
      // the .test host and keeps this off the card rail.
      merchant: {
        id: 'bill',
        name: body.venue,
        url: 'https://venue.local.test',
        country_code_iso2: 'US',
      },
      cart,
      members: body.members.map((m) => ({
        name: m.name,
        role: 'payer' as const,
        weight: 1,
        user_id: m.user_id,
      })),
      policy: (body.policy as never) ?? { type: 'all_of' },
      tolerance_bps: 0, // the bill is the bill; there is no quote to drift
      straggler_policy: 'retry_once',
      no_blame: body.no_blame,
      deadline_minutes: body.deadline_minutes,
      display_currencies: ['INR', 'EUR', 'GBP'],
      auction_window_seconds: 60,
      created_by: me?.id,
      rail: 'at_venue',
      origin: 'bill',
    })

    return reply.status(201).send({
      group_id: group.id,
      rail: group.rail,
      disclosure: capabilityOf(group.rail).disclosure,
      reconciliation: bill.reconciliation,
      warnings: bill.warnings,
      unparsed_lines: bill.unparsed_lines,
      members: members.map((m) => ({
        member_id: m.id,
        name: m.display_name,
        share_amount: m.share_amount,
      })),
    })
  })

  // ---- discovery ---------------------------------------------------------
  // Every route below fans out to real merchant/catalog sources on the
  // caller's behalf — the same "spends someone else's rate limit" concern
  // as the plan layer's places/agent routes, so they get the same tighter,
  // still demo-generous ceiling instead of the global default.

  app.get('/v1/discover/search', spendLimit(30), async (req) => {
    const { q = '', merchant, limit } = req.query as { q?: string; merchant?: string; limit?: string }
    const query = q.trim()
    if (!query) return { products: [], sources: [], query, took_ms: 0 }

    // A pasted link is an instruction to resolve, not to search.
    if (Catalog.looksLikeUrl(query)) {
      const resolved = await catalog.resolve(query.startsWith('http') ? query : `https://${query}`)
      return {
        products: resolved.product ? [resolved.product] : [],
        sources: [{ kind: 'url', label: `Resolved from ${resolved.strategy}`, count: resolved.product ? 1 : 0, ms: 0 }],
        query,
        took_ms: 0,
        resolved: true,
        warnings: resolved.warnings,
      }
    }

    return catalog.search(query, {
      merchant: merchant?.trim() || undefined,
      limit: limit ? Math.min(40, Number(limit)) : 12,
    })
  })

  /**
   * The same federated search, grouped into like-for-like offers so the
   * cheapest one can be named. Kept separate from /search because it answers a
   * different question — "which of these is the same thing, and which of those
   * is cheapest per unit" — and because it is allowed to return nothing at all
   * when it cannot honestly group anything.
   */
  app.get('/v1/discover/compare', spendLimit(30), async (req) => {
    const { q = '', limit } = req.query as { q?: string; limit?: string }
    const query = q.trim()
    if (!query) return { groups: [], ungrouped: [], currencies: [], query, sources: [], took_ms: 0 }

    // Cast the net wider than a normal search: comparison needs several
    // listings of the same thing before it can say anything at all.
    const found = await catalog.search(query, { limit: limit ? Math.min(60, Number(limit)) : 40 })
    const compared = compareOffers(found.products)
    return {
      ...compared,
      query,
      sources: found.sources,
      took_ms: found.took_ms,
      searched: found.products.length,
    }
  })

  app.post('/v1/discover/resolve', spendLimit(30), async (req) => {
    const body = z.object({ url: z.string().min(4).max(2048) }).parse(req.body)
    const result = await catalog.resolve(body.url)
    if (!result.product) {
      throw new UserError(result.warnings[0] ?? 'could not read a product from that link')
    }
    return result
  })

  app.get('/v1/discover/sources', async () => ({ sources: catalog.sourceStatus() }))
}
