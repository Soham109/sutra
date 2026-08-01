// Messages: a live thread on a plan or a group, and the one surface where
// tagging @sutra gets you an answer in the room instead of a separate API
// call. Kept as its own file for the same reason delegate/routes.ts is its
// own file — this is a client built on top of the plan/group contracts, not
// an extension of either.
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { DelegateStore } from '../delegate/store.js'
import type { PlanService } from '../plan/service.js'
import type { PlanStore } from '../plan/store.js'
import { UserError, type GroupService } from '../service.js'
import { spendLimit } from '../rate-limit.js'
import type { Social, User } from '../social.js'
import type { GroupRow } from '../types.js'
import type { PlanRow } from '../plan/types.js'
import { mentionsSutra, newMessageId, replyToGroupMention, replyToPlanMention, SUTRA_BOT_NAME } from './bot.js'
import type { MessagePayload, MessageView } from './types.js'

export interface MessageRoutesDeps {
  plans: PlanService
  planStore: PlanStore
  groups: GroupService
  delegateStore: DelegateStore
  social: Social
  currentUser: (req: { headers: Record<string, unknown> }) => User | undefined
  apiToken: string
}

const PostMessageSchema = z.object({ text: z.string().min(1).max(2000) })

export function registerMessageRoutes(app: FastifyInstance, d: MessageRoutesDeps): void {
  const requireUser = (req: { headers: Record<string, unknown> }): User => {
    const u = d.currentUser(req)
    if (!u) throw new UserError('sign in to continue', 401)
    return u
  }

  // Posting requires a real account (unlike a plan's own signal endpoints,
  // which deliberately accept a bare participant link with no login — see
  // routes-plan.ts's note on why a bearer-link stays that way for signals).
  // A chat message carries a name and, implicitly, a face; the pass-the-phone
  // model that makes sense for "are you free Saturday" does not extend to a
  // thread other people are going to read back later.
  const holdsToken = (req: { headers: Record<string, unknown> }) => req.headers.authorization === `Bearer ${d.apiToken}`

  const requirePlanMember = (req: { headers: Record<string, unknown> }, plan: PlanRow, me: User): void => {
    const isOrganiser = !!plan.created_by && plan.created_by === me.id
    const seat = d.planStore.participantForUser(plan.id, me.id)
    if (!holdsToken(req) && !isOrganiser && !seat) {
      throw new UserError('you are not part of this plan', 403)
    }
  }

  const requireGroupMember = (req: { headers: Record<string, unknown> }, group: GroupRow, me: User): void => {
    const isOrganiser = !!group.created_by && group.created_by === me.id
    const isMember = d.groups.db.membersOf(group.id).some((m) => m.user_id === me.id)
    if (!holdsToken(req) && !isOrganiser && !isMember) {
      throw new UserError('you are not part of this group', 403)
    }
  }

  // ---- plan thread ---------------------------------------------------------

  app.get('/v1/plans/:id/messages', async (req) => {
    const { id } = req.params as { id: string }
    const plan = d.plans.mustPlan(id)
    const me = requireUser(req)
    requirePlanMember(req, plan, me)
    return { messages: readMessages(d.planStore.eventsAfter(id, 0)) }
  })

  app.post('/v1/plans/:id/messages', spendLimit(40), async (req, reply) => {
    const { id } = req.params as { id: string }
    const plan = d.plans.mustPlan(id)
    const me = requireUser(req)
    requirePlanMember(req, plan, me)
    const body = PostMessageSchema.parse(req.body)

    d.planStore.appendEvent(id, null, 'message.posted', userMessage(me, body.text))

    if (mentionsSutra(body.text)) {
      const botText = await safeBotReply(async () => {
        const r = await replyToPlanMention(
          { plans: d.plans, planStore: d.planStore, delegateStore: d.delegateStore },
          plan,
          me.id,
          body.text,
        )
        return r
      })
      d.planStore.appendEvent(id, null, 'message.posted', botMessage(botText.text, botText.usedRules))
    }

    return reply.status(201).send({ messages: readMessages(d.planStore.eventsAfter(id, 0)) })
  })

  // ---- group thread ---------------------------------------------------------

  app.get('/v1/groups/:id/messages', async (req) => {
    const { id } = req.params as { id: string }
    const group = d.groups.mustGroup(id)
    const me = requireUser(req)
    requireGroupMember(req, group, me)
    return { messages: readMessages(d.groups.db.eventsAfter(id, 0)) }
  })

  app.post('/v1/groups/:id/messages', spendLimit(40), async (req, reply) => {
    const { id } = req.params as { id: string }
    const group = d.groups.mustGroup(id)
    const me = requireUser(req)
    requireGroupMember(req, group, me)
    const body = PostMessageSchema.parse(req.body)

    // Straight appendEvent, not hub.emit: a chat line is not part of the GMP/1
    // protocol narrative (no webhook subscriber should fire on it — see
    // events.ts's WEBHOOK_EVENT_TYPES allowlist), but it still needs to land
    // in the same log the group's own SSE stream already replays and tails.
    d.groups.db.appendEvent(id, null, 'message.posted', userMessage(me, body.text))

    if (mentionsSutra(body.text)) {
      const members = d.groups.db.membersOf(id)
      const botText = await safeBotReply(async () => ({
        text: replyToGroupMention(group, members, body.text),
        usedRules: [] as string[],
      }))
      d.groups.db.appendEvent(id, null, 'message.posted', botMessage(botText.text, botText.usedRules))
    }

    return reply.status(201).send({ messages: readMessages(d.groups.db.eventsAfter(id, 0)) })
  })
}

// ---------------------------------------------------------------------------

function userMessage(me: User, text: string): MessagePayload {
  return {
    message_id: newMessageId(),
    from: 'user',
    author_user_id: me.id,
    author_name: me.name,
    text,
    mentions_sutra: mentionsSutra(text),
  }
}

function botMessage(text: string, usedRules: string[]): MessagePayload {
  return {
    message_id: newMessageId(),
    from: 'bot',
    author_user_id: null,
    author_name: SUTRA_BOT_NAME,
    text,
    mentions_sutra: false,
    used_rules: usedRules.length > 0 ? usedRules : undefined,
  }
}

/**
 * A bug in the bot must never eat the human's own message — it is already
 * durably appended by the time this runs. Same posture as extractIntent's own
 * catch around a model call: a failure downgrades to a plain apology, not a
 * 500 that leaves the poster wondering whether anything sent at all.
 */
async function safeBotReply(
  fn: () => Promise<{ text: string; usedRules: string[] }>,
): Promise<{ text: string; usedRules: string[] }> {
  try {
    return await fn()
  } catch {
    return { text: "Sorry, I couldn't work that out just now — try asking again?", usedRules: [] }
  }
}

function readMessages(
  events: { seq: number; type: string; payload_json: string; created_at: string }[],
): MessageView[] {
  return events
    .filter((e) => e.type === 'message.posted')
    .map((e) => ({ seq: e.seq, created_at: e.created_at, ...(JSON.parse(e.payload_json) as MessagePayload) }))
}
