// Discovery + social routes. Kept beside the protocol routes rather than
// inside them: /v1/groups is the frozen GMP/1 contract other apps integrate
// against, and this surface is the product built on top of it.
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { Catalog } from './catalog/index.js'
import { billToCart, parseBill } from './bill/index.js'
import { inferBillCurrency } from './bill/currency.js'
import type { PlanStore } from './plan/store.js'
import { capabilityOf } from './rails.js'
import { UserError, type GroupService } from './service.js'
import { Social, type User } from './social.js'
import { groupView } from './routes.js'
import { cartTotal, GROUP_TERMINAL, type Cart } from './types.js'

const USER_COOKIE = 'sutra_uid'

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
  const m = new RegExp(`${USER_COOKIE}=([^;]+)`).exec(raw)
  const headerId = String(req.headers['x-sutra-user'] ?? '')
  const id = headerId || (m?.[1] ? decodeURIComponent(m[1]) : '')
  return id ? social.byId(id) : undefined
}

export function registerProductRoutes(
  app: FastifyInstance,
  service: GroupService,
  social: Social,
  catalog: Catalog,
  planStore: PlanStore,
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

  app.post('/v1/me', async (req, reply) => {
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
      friends: social.friendsOf(user.id),
      circles: social.circlesFor(user.id),
    }
  })

  app.post('/v1/me/signout', async (_req, reply) => {
    reply.header('set-cookie', `${USER_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`)
    return { ok: true }
  })

  // ---- people ------------------------------------------------------------

  app.get('/v1/people', async (req) => {
    const q = String((req.query as { q?: string }).q ?? '').toLowerCase()
    const me = currentUser(req)
    const friendIds = new Set(me ? social.friendsOf(me.id).map((f) => f.id) : [])
    return {
      people: social
        .allUsers()
        .filter((u) => !q || u.name.toLowerCase().includes(q) || u.handle.includes(q))
        .map((u) => ({ ...u, is_friend: friendIds.has(u.id), is_me: u.id === me?.id })),
    }
  })

  app.post('/v1/people/:id/friend', async (req) => {
    const me = requireUser(req)
    const { id } = req.params as { id: string }
    if (!social.byId(id)) throw new UserError('no such person', 404)
    social.addFriend(me.id, id)
    return { friends: social.friendsOf(me.id) }
  })

  app.post('/v1/people/:id/unfriend', async (req) => {
    const me = requireUser(req)
    const { id } = req.params as { id: string }
    social.removeFriend(me.id, id)
    return { friends: social.friendsOf(me.id) }
  })

  app.get('/v1/people/:id/reliability', async (req) => {
    const { id } = req.params as { id: string }
    const user = social.byId(id)
    if (!user) throw new UserError('no such person', 404)
    return { user, reliability: social.reliability(id) }
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
    return { circle: { ...circle, members: social.circleMembers(circle.id) } }
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

  app.post('/v1/bill/parse', async (req) => {
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
    return parsed
  })

  /** A parsed bill plus who claimed what → a real group on the at_venue rail. */
  app.post('/v1/bill/split', async (req, reply) => {
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
      })
      .parse(req.body)

    const bill = await parseBill(
      { text: body.text, image_base64: body.image_base64 },
      { currency: inferBillCurrency(body.text ?? '').currency ?? undefined },
    )
    const cart = billToCart(bill, { claimantsByItemIndex: body.claimants })

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

  app.get('/v1/discover/search', async (req) => {
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

  app.post('/v1/discover/resolve', async (req) => {
    const body = z.object({ url: z.string().min(4).max(2048) }).parse(req.body)
    const result = await catalog.resolve(body.url)
    if (!result.product) {
      throw new UserError(result.warnings[0] ?? 'could not read a product from that link')
    }
    return result
  })

  app.get('/v1/discover/sources', async () => ({ sources: catalog.sourceStatus() }))
}
