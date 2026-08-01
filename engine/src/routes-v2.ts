// Discovery + social routes. Kept beside the protocol routes rather than
// inside them: /v1/groups is the frozen GMP/1 contract other apps integrate
// against, and this surface is the product built on top of it.
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { Catalog } from './catalog/index.js'
import { UserError, type GroupService } from './service.js'
import { Social, type User } from './social.js'
import { groupView } from './routes.js'

const USER_COOKIE = 'sutra_uid'

export function registerProductRoutes(
  app: FastifyInstance,
  service: GroupService,
  social: Social,
  catalog: Catalog,
): void {
  // ---- identity ----------------------------------------------------------
  // Deliberately lightweight: a handle picks who you are, stored in a cookie.
  // Real auth is a day-two problem; nothing here grants spending power, and
  // spending still requires the member's own passkey on Prava's page.

  const currentUser = (req: { headers: Record<string, unknown> }): User | undefined => {
    const raw = String(req.headers['cookie'] ?? '')
    const m = new RegExp(`${USER_COOKIE}=([^;]+)`).exec(raw)
    const headerId = String(req.headers['x-sutra-user'] ?? '')
    const id = headerId || (m?.[1] ? decodeURIComponent(m[1]) : '')
    return id ? social.byId(id) : undefined
  }

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
