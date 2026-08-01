import { decideSignals, type StandingRules } from '../delegate/rules.js'
import type { DelegateStore } from '../delegate/store.js'
import type { CommonWindow } from '../plan/time.js'
import type { PlanService } from '../plan/service.js'
import type { PlanStore } from '../plan/store.js'
import {
  PLAN_TERMINAL,
  SlotsSchema,
  type PlanOptionRow,
  type PlanParticipantRow,
  type PlanRow,
  type SignalKind,
  type SignalPayload,
  type SignalRow,
  type Slots,
} from '../plan/types.js'
import { cartTotal, type Cart, type GroupRow, type MemberRow } from '../types.js'
import { ulid } from '../ids.js'

// ---------------------------------------------------------------------------
// The @sutra bot: a coordination delegate that talks in the thread instead of
// only answering an API call.
//
// Every reply in this file is built from exactly two ingredients: real rows
// already in the plan/group store, and — when the tagger has standing rules
// on file — decideSignals' own arithmetic (delegate/rules.ts). There is no
// third ingredient. No model call, no invented venue, no invented name. If a
// question has no answer in either of those two places, the honest reply is
// "I don't know that yet," never a guess dressed up as one.
//
// That is also why this module needs no OPENAI_API_KEY: unlike
// agent/extract.ts, which reaches for a model to parse messy free text into
// slots, this bot only ever has to pick ONE of a small, fixed set of known
// questions apart — a job the deterministic keyword tables below do exactly
// as reliably as a model would, without a network round trip or a new way
// for the "no invented facts" rule to be broken.
// ---------------------------------------------------------------------------

export const SUTRA_BOT_NAME = 'Sutra'

export const newMessageId = (): string => `ms_${ulid()}`

const MENTION_RE = /(^|[^a-z0-9_@])@sutra\b/i

/** Does this message address the bot at all? Everything below only runs when it does. */
export function mentionsSutra(text: string): boolean {
  return MENTION_RE.test(text)
}

// ---------------------------------------------------------------------------
// The one hard boundary. "Refuse anything to do with paying" is read broadly
// and on purpose: the alternative is a regex clever enough to tell "who's
// paying?" (a status question, fine) apart from "pay my share" (a directive,
// never fine) in every phrasing a hackathon demo table can throw at it. That
// distinction is exactly the kind of judgment call this bot does not get to
// make — decideSignals refuses the same way, on purpose (see rules.ts). So
// any message that is *shaped* like a payment instruction gets the same fixed
// refusal, whether it was a command or a question. The bot still answers real
// questions about money — a stated budget, a cart total, who has approved —
// through the ordinary 'budget' and 'who' intents below; what it will never
// do is take, or claim to have taken, a payment action.
// ---------------------------------------------------------------------------

const PAYMENT_WORDS = /\b(approve|approving|approval|checkout|check-?out|mandate|autopay|swipe|reimburse|refund)\b/i
const PAYMENT_PHRASES = [
  'pay for', 'pay my', 'pay our', 'pay his', 'pay her', 'pay their', 'pay the bill',
  'pay this', 'pay that', 'pay it', 'pay now', 'pay me', 'pay us',
  'charge my', 'charge our', 'charge his', 'charge her', 'charge their',
  'charge me', 'charge us', 'charge the card', 'charge everyone', 'charge my card',
  'accept my share', 'accept the share', 'accept our share', 'accept his share', 'accept her share',
  'buy it', 'buy this', 'buy that', 'buy the', 'purchase it', 'purchase this', 'purchase the',
  'settle up', 'settle my share', 'settle the bill', 'settle our tab', 'settle my bill',
  'confirm the payment', 'confirm payment', 'confirm the charge', 'confirm the mandate',
  'process the payment', 'process payment',
  'put it on my card', 'put this on my card', 'on my behalf', 'on my card',
  'complete the payment', 'complete the purchase', 'complete the transaction',
]

export function isPaymentRequest(text: string): boolean {
  const t = text.toLowerCase().replace(/[.,!?;:]/g, ' ').replace(/\s+/g, ' ')
  if (PAYMENT_WORDS.test(t)) return true
  return PAYMENT_PHRASES.some((p) => t.includes(p))
}

export const PAYMENT_REFUSAL =
  "I don't touch payments — I can't approve a mandate, charge a card, or accept anyone's share. " +
  'That only happens when a person completes it themselves, on their own device. ' +
  "I can tell you who's approved so far, or what the numbers are, if that helps."

// ---------------------------------------------------------------------------
// Intent — one of a small, fixed set. 'refresh' only exists on a plan: a
// group already has a committed cart, so there is nothing left to search for.
// ---------------------------------------------------------------------------

export type Intent = 'payment' | 'refresh' | 'who' | 'when' | 'options' | 'budget' | 'help'

const REFRESH_RE = /\b(refresh|search again|look again|find more|new places|new options|update the options|try again|re-?search)\b/i
const WHO_RE = /\b(who'?s in|who is in|who'?s coming|who is coming|whos in|attending|rsvp|who replied|who answered|who'?s going|who is going|who'?s approved|who has approved|who approved)\b/i
const WHEN_RE = /\b(best time|what time|when (are we|is it|works|can)|schedule|common window|good time|free when|deadline)\b/i
const OPTIONS_RE = /\b(options?|venues?|places?|where (should|can|are|to)|what.*(picked|choices|chosen)|what did we choose|what'?s in the cart|cart)\b/i
const BUDGET_RE = /\b(budget|price|cost|how much|afford|cap|expensive|total)\b/i

export function classifyIntent(text: string, scope: 'plan' | 'group'): Intent {
  if (isPaymentRequest(text)) return 'payment'
  if (scope === 'plan' && REFRESH_RE.test(text)) return 'refresh'
  if (WHO_RE.test(text)) return 'who'
  if (WHEN_RE.test(text)) return 'when'
  if (OPTIONS_RE.test(text)) return 'options'
  if (BUDGET_RE.test(text)) return 'budget'
  return 'help'
}

// ---------------------------------------------------------------------------
// Small local formatters. Duplicated rather than imported from rank.ts /
// rules.ts on purpose — same reasoning those two give for duplicating each
// other's `money()`: this file has exactly one job, and importing a private
// helper from a scoring module would tie this bot's uptime to that module's.
// ---------------------------------------------------------------------------

const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'XAF', 'XOF', 'UGX', 'RWF'])

function fmtMoney(minor: number, currency: string): string {
  const cur = currency.toUpperCase()
  return ZERO_DECIMAL.has(cur) ? `${cur} ${minor}` : `${cur} ${(minor / 100).toFixed(2)}`
}

function fmtWindow(w: { start: string; end: string }): string {
  const s = new Date(w.start)
  const e = new Date(w.end)
  const day = (d: Date) => d.toISOString().slice(0, 10)
  const hm = (d: Date) => d.toISOString().slice(11, 16)
  return day(s) === day(e) ? `${day(s)} ${hm(s)}–${hm(e)} UTC` : `${day(s)} ${hm(s)} → ${day(e)} ${hm(e)} UTC`
}

function list(names: string[]): string {
  if (names.length === 0) return ''
  if (names.length <= 2) return names.join(' and ')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

// ---------------------------------------------------------------------------
// Plan answers — pure. Every fact here traces to a row already in `state`;
// nothing is fetched, guessed, or interpolated from the model.
// ---------------------------------------------------------------------------

export interface PlanBotState {
  plan: PlanRow
  participants: PlanParticipantRow[]
  /** currentSignals(planId) — latest per (participant, kind) */
  signals: SignalRow[]
  options: PlanOptionRow[]
  bestWindows: CommonWindow[]
}

function rsvpByParticipant(signals: SignalRow[]): Map<string, boolean> {
  const out = new Map<string, boolean>()
  for (const s of signals) {
    if (s.kind !== 'rsvp') continue
    out.set(s.participant_id, (JSON.parse(s.payload_json) as { in: boolean }).in)
  }
  return out
}

export function describeWho(state: PlanBotState): string {
  const { participants } = state
  if (participants.length === 0) return 'Nobody is on this plan yet.'
  const rsvp = rsvpByParticipant(state.signals)
  const inList = participants.filter((p) => rsvp.get(p.id) === true).map((p) => p.display_name)
  const outList = participants.filter((p) => rsvp.get(p.id) === false).map((p) => p.display_name)
  const unanswered = participants.filter((p) => !rsvp.has(p.id)).map((p) => p.display_name)

  if (inList.length === 0 && outList.length === 0) {
    return `Nobody has RSVP'd yet. Still waiting on ${list(unanswered)}.`
  }
  const parts: string[] = []
  if (inList.length > 0) parts.push(`${list(inList)} ${inList.length === 1 ? 'is' : 'are'} in`)
  if (outList.length > 0) parts.push(`${list(outList)} ${outList.length === 1 ? 'is' : 'are'} out`)
  if (unanswered.length > 0) {
    parts.push(`${list(unanswered)} ${unanswered.length === 1 ? "hasn't" : "haven't"} answered yet`)
  }
  return `${parts.join('; ')}.`
}

export function describeWhen(state: PlanBotState): string {
  const best = state.bestWindows[0]
  if (!best) {
    const anyAvailability = state.signals.some((s) => s.kind === 'availability')
    return anyAvailability
      ? "Nobody's availability overlaps yet — there's no common window at least an hour long."
      : 'Nobody has shared their availability yet.'
  }
  const names = new Map(state.participants.map((p) => [p.id, p.display_name]))
  const who = best.available.map((id) => names.get(id) ?? 'someone')
  return `Best common window: ${fmtWindow(best.window)} — ${list(who)} can make it (${best.count} of ${state.participants.length}).`
}

export function describeOptions(state: PlanBotState): string {
  if (state.options.length === 0) {
    return "Nothing on the board yet. Tag me with 'refresh' once someone's shared where they are, and I'll search."
  }
  const lines = state.options.slice(0, 5).map((o, i) => {
    const price = o.price_json ? (JSON.parse(o.price_json) as { amount_minor: number; currency: string }) : null
    const priceText = price ? `, ${fmtMoney(price.amount_minor, price.currency)}` : ''
    return `${i + 1}. ${o.title}${o.subtitle ? ` (${o.subtitle})` : ''}${priceText}`
  })
  const more = state.options.length > 5 ? ` …and ${state.options.length - 5} more.` : ''
  return `${state.options.length} option${state.options.length === 1 ? '' : 's'} on the board:\n${lines.join('\n')}${more}`
}

export interface BudgetAnswer {
  text: string
  usedRules: string[]
}

/**
 * The plan's own stated ceiling wins when it has one — that is group
 * consensus, safe to state as fact. Absent that, the tagger's own standing
 * budget is offered as a reference and EXPLICITLY marked as theirs, not the
 * group's: stating it as "the budget" would be inventing a plan fact out of
 * one person's private preference.
 */
export function describeBudget(slots: Slots, taggerRules?: StandingRules): BudgetAnswer {
  if (slots.budget_ceiling_minor !== undefined) {
    return {
      text: `This plan's stated budget is ${fmtMoney(slots.budget_ceiling_minor, slots.currency)} per person.`,
      usedRules: [],
    }
  }
  if (taggerRules?.budget_ceiling_minor !== undefined && taggerRules.currency) {
    return {
      text:
        `The plan hasn't set a budget yet. Using your standing budget of ` +
        `${fmtMoney(taggerRules.budget_ceiling_minor, taggerRules.currency)} as a reference — ` +
        `that's your own ceiling, not something the group has agreed to.`,
      usedRules: ['budget_ceiling_minor'],
    }
  }
  return {
    text: "Nobody has set a budget for this plan yet, and you don't have a standing budget on file either.",
    usedRules: [],
  }
}

export const PLAN_HELP =
  "Tag me and ask who's in, what the best time is, or what the options are — or say 'refresh' and " +
  "I'll search again. I only answer from what people have actually said; I never guess."

export function answerPlanQuestion(
  intent: Exclude<Intent, 'refresh'>,
  state: PlanBotState,
  taggerRules?: StandingRules,
): { text: string; usedRules: string[] } {
  switch (intent) {
    case 'payment':
      return { text: PAYMENT_REFUSAL, usedRules: [] }
    case 'who':
      return { text: describeWho(state), usedRules: [] }
    case 'when':
      return { text: describeWhen(state), usedRules: [] }
    case 'options':
      return { text: describeOptions(state), usedRules: [] }
    case 'budget': {
      const slots = SlotsSchema.parse(JSON.parse(state.plan.slots_json))
      return describeBudget(slots, taggerRules)
    }
    case 'help':
    default:
      return { text: PLAN_HELP, usedRules: [] }
  }
}

// ---------------------------------------------------------------------------
// The one action: refresh the venue/product board. I/O lives here (this
// function submits real signals and runs a real search) so everything above
// stays pure and trivially testable; only this orchestrator needs a plan
// service, a store and the delegate store.
//
// It reuses decideSignals + submitSignal exactly as the existing delegate
// route does (delegate/routes.ts) — the tagger's own standing rules fill in
// whatever open question they hadn't answered yet, attributed as a
// `delegate.answered` event exactly like that route already attributes it,
// so the plan timeline tells the same story whether the delegate call came
// from the API or from a chat mention.
// ---------------------------------------------------------------------------

export interface PlanBotDeps {
  plans: PlanService
  planStore: PlanStore
  delegateStore: DelegateStore
}

export interface RefreshOutcome {
  /** signal kinds actually filled from standing rules, e.g. ['budget'] */
  usedRuleFields: string[]
  /** human phrases for those, e.g. 'your standing budget (INR 800.00)' */
  ruleDisclosure: string[]
  optionCount: number
  /** the human sentence the search itself produced (empty-result reason, or a summary) */
  note: string
}

function ruleDisclosureFor(signal: SignalPayload): string | null {
  switch (signal.kind) {
    case 'location':
      return `your standing home (${signal.place.label})`
    case 'budget':
      return `your standing budget (${fmtMoney(signal.ceiling_minor, signal.currency)})`
    case 'availability':
      return 'your standing availability'
    case 'constraint':
      return `your standing constraint ("${signal.text}")`
    case 'rsvp':
      return 'your standing RSVP rule'
    default:
      return null
  }
}

export async function runRefresh(
  deps: PlanBotDeps,
  plan: PlanRow,
  taggerUserId: string,
): Promise<RefreshOutcome> {
  if (PLAN_TERMINAL.has(plan.status)) {
    return {
      usedRuleFields: [],
      ruleDisclosure: [],
      optionCount: deps.planStore.options(plan.id).length,
      note: "This plan is closed, so there's nothing left to refresh.",
    }
  }

  const usedRuleFields: string[] = []
  const ruleDisclosure: string[] = []

  const participant = deps.planStore.participantForUser(plan.id, taggerUserId)
  const rules = participant ? deps.delegateStore.getRules(taggerUserId) : undefined
  if (participant && rules) {
    const answered = new Set(
      deps.planStore
        .currentSignals(plan.id)
        .filter((s) => s.participant_id === participant.id)
        .map((s) => s.kind),
    )
    const ask = (JSON.parse(plan.ask_json) as SignalKind[]).filter((k) => !answered.has(k))
    if (ask.length > 0) {
      const slots = SlotsSchema.parse(JSON.parse(plan.slots_json))
      const { signals } = decideSignals(rules, { ask, slots })
      for (const signal of signals) {
        await deps.plans.submitSignal(participant.id, signal)
        // Same event type the existing delegate route writes (delegate/routes.ts)
        // — the timeline should not be able to tell these two callers apart.
        deps.planStore.appendEvent(plan.id, participant.id, 'delegate.answered', {
          kind: signal.kind,
          via: 'sutra',
        })
        usedRuleFields.push(signal.kind)
        const label = ruleDisclosureFor(signal)
        if (label) ruleDisclosure.push(label)
      }
    }
  }

  let note = ''
  try {
    const before = deps.planStore.eventsAfter(plan.id, 0).at(-1)?.seq ?? 0
    await deps.plans.generateOptions(plan.id)
    const tail = deps.planStore.eventsAfter(plan.id, before).at(-1)
    if (tail && (tail.type === 'options.generated' || tail.type === 'options.refresh_empty')) {
      note = String((JSON.parse(tail.payload_json) as { note?: string }).note ?? '')
    }
  } catch (e) {
    note = e instanceof Error ? e.message : 'could not refresh the board just now'
  }

  return {
    usedRuleFields,
    ruleDisclosure,
    optionCount: deps.planStore.options(plan.id).length,
    note,
  }
}

export function describeRefresh(o: RefreshOutcome): string {
  const used = o.ruleDisclosure.length > 0 ? `Filled in ${list(o.ruleDisclosure)} first. ` : ''
  if (o.optionCount === 0) return `${used}${o.note || 'Still nothing on the board.'}`
  return `${used}Refreshed the board${o.note ? `: ${o.note}` : ` — ${o.optionCount} option${o.optionCount === 1 ? '' : 's'} now up.`}`
}

/** The one entry point routes.ts calls for a plan mention. */
export async function replyToPlanMention(
  deps: PlanBotDeps,
  plan: PlanRow,
  taggerUserId: string,
  text: string,
): Promise<{ text: string; usedRules: string[] }> {
  const intent = classifyIntent(text, 'plan')
  if (intent === 'refresh') {
    const outcome = await runRefresh(deps, plan, taggerUserId)
    return { text: describeRefresh(outcome), usedRules: outcome.usedRuleFields }
  }
  const state: PlanBotState = {
    plan,
    participants: deps.planStore.participants(plan.id),
    signals: deps.planStore.currentSignals(plan.id),
    options: deps.planStore.options(plan.id),
    bestWindows: deps.plans.commonWindows(plan.id),
  }
  const taggerRules = deps.delegateStore.getRules(taggerUserId)
  return answerPlanQuestion(intent, state, taggerRules)
}

// ---------------------------------------------------------------------------
// Group answers — pure, and read-only in every sense: there is no action
// intent for a group at all, because by the time a plan becomes a group the
// cart is already chosen. There is nothing left to search for, only the
// consent thread to report on.
// ---------------------------------------------------------------------------

export interface GroupBotState {
  group: GroupRow
  members: MemberRow[]
}

const APPROVED_LIKE = new Set(['approved', 'charging', 'charged', 'settled'])
const OUT_LIKE = new Set(['declined', 'dropped', 'expired', 'failed'])
const PENDING_LIKE = new Set(['invited', 'viewed', 'awaiting_approval'])

export function describeGroupWho(state: GroupBotState): string {
  const payers = state.members.filter((m) => m.role !== 'observer')
  if (payers.length === 0) return 'Nobody is on this group yet.'
  const approved = payers.filter((m) => APPROVED_LIKE.has(m.status)).map((m) => m.display_name)
  const pending = payers.filter((m) => PENDING_LIKE.has(m.status)).map((m) => m.display_name)
  const out = payers.filter((m) => OUT_LIKE.has(m.status)).map((m) => m.display_name)

  const parts: string[] = []
  if (approved.length > 0) parts.push(`${list(approved)} ${approved.length === 1 ? 'has' : 'have'} approved`)
  if (pending.length > 0) parts.push(`still waiting on ${list(pending)}`)
  if (out.length > 0) parts.push(`${list(out)} ${out.length === 1 ? 'is' : 'are'} out`)
  return parts.length > 0 ? `${parts.join('; ')}.` : 'Nobody has answered yet.'
}

export function describeGroupCart(state: GroupBotState): string {
  const cart = JSON.parse(state.group.cart_json) as Cart
  const total = cartTotal(cart)
  const lines = cart.items.map((i) => `${i.qty > 1 ? `${i.qty}× ` : ''}${i.name}`)
  const payers = state.members.filter((m) => m.role !== 'observer').length
  return `${state.group.title}: ${list(lines)}. Total ${fmtMoney(total, state.group.currency)} across ${payers} ${payers === 1 ? 'person' : 'people'}.`
}

export function describeGroupWhen(state: GroupBotState): string {
  const at = new Date(state.group.deadline_at)
  const passed = at.getTime() <= Date.now()
  const when = `${at.toISOString().slice(0, 10)} ${at.toISOString().slice(11, 16)} UTC`
  return passed
    ? 'The deadline has already passed — this group is deciding on what came in.'
    : `Deadline is ${when}.`
}

export const GROUP_HELP =
  "Tag me and ask who's approved, what's in the cart, or when the deadline is. I don't touch payments."

export function answerGroupQuestion(intent: Intent, state: GroupBotState): string {
  switch (intent) {
    case 'payment':
      return PAYMENT_REFUSAL
    case 'who':
      return describeGroupWho(state)
    case 'options':
    case 'budget':
      return describeGroupCart(state)
    case 'when':
      return describeGroupWhen(state)
    default:
      return GROUP_HELP
  }
}

/** The one entry point routes.ts calls for a group mention. Pure — no I/O. */
export function replyToGroupMention(group: GroupRow, members: MemberRow[], text: string): string {
  return answerGroupQuestion(classifyIntent(text, 'group'), { group, members })
}
