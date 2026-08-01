import { classifyCategory } from '../agent/classify.js'
import type { Catalog } from '../catalog/index.js'
import type { Places } from '../places/index.js'
import { resolveCategory } from '../places/taxonomy.js'
import type { Rail } from '../rails.js'
import type { GroupService } from '../service.js'
import { UserError } from '../service.js'
import type { Social } from '../social.js'
import { boundingRadiusM, centroid, haversineKm } from './geo.js'
import { rankOptions, type RankParticipant } from './rank.js'
import { bestCommonWindows } from './time.js'
import { optionId as newOptionId, participantId as newParticipantId, planId as newPlanId, PlanStore } from './store.js'
import {
  CreatePlanSchema,
  OptionInputSchema,
  PLAN_TERMINAL,
  SignalPayloadSchema,
  SlotsSchema,
  type CreatePlanInput,
  type OptionInput,
  type Place,
  type PlanOptionRow,
  type PlanRow,
  type SignalPayload,
  type Slots,
} from './types.js'
import type { Cart, CartItem } from '../types.js'

// ---------------------------------------------------------------------------
// The coordination phase, orchestrated.
//
// Nothing here decides anything on its own judgement. Signals come from
// humans, options come from named external sources with traceable provenance,
// the ordering comes from rank.ts's arithmetic, and the group that finally
// gets created is the ordinary GMP/1 object the protocol already knows how to
// commit. The plan layer is a funnel, not an authority.
// ---------------------------------------------------------------------------

export interface PlanServiceDeps {
  store: PlanStore
  groups: GroupService
  places: Places
  catalog: Catalog
  social: Social
  now?: () => Date
}

/** How many options we put on the board. More than this is noise, not choice. */
const MAX_OPTIONS = 8

export class PlanService {
  private readonly now: () => Date

  constructor(private readonly d: PlanServiceDeps) {
    this.now = d.now ?? (() => new Date())
  }

  // -------------------------------------------------------------------------
  // Creation and invitation
  // -------------------------------------------------------------------------

  createPlan(input: CreatePlanInput, actorUserId?: string): { plan: PlanRow } {
    const parsed = CreatePlanSchema.parse(input)
    const slots = SlotsSchema.parse(parsed.slots ?? {})
    const id = newPlanId()
    const deadline = new Date(this.now().getTime() + parsed.deadline_minutes * 60_000)

    this.d.store.insertPlan({
      id,
      title: parsed.title?.trim() || titleFrom(parsed.intent_text),
      intent_text: parsed.intent_text,
      kind: parsed.kind,
      slots_json: JSON.stringify(slots),
      ask_json: JSON.stringify(parsed.ask),
      status: 'gathering',
      chosen_option_id: null,
      group_id: null,
      // Provisional. The rail is only really decided when an option is chosen,
      // because that is when we learn whether a chargeable merchant exists.
      rail: 'prava_mandates',
      deadline_at: deadline.toISOString(),
      created_by: actorUserId ?? null,
      circle_id: parsed.circle_id ?? null,
    })

    // The organiser is a participant. Someone has to be able to answer their
    // own question about when they are free.
    const seats = [...parsed.participants]
    if (actorUserId && !seats.some((p) => p.user_id === actorUserId)) {
      const me = this.d.social.byId(actorUserId)
      seats.unshift({ name: me?.name ?? 'Organiser', user_id: actorUserId, role: 'organizer' })
    }
    if (parsed.circle_id) {
      for (const u of this.d.social.circleMembers(parsed.circle_id)) {
        if (seats.some((p) => p.user_id === u.id)) continue
        seats.push({ name: u.name, user_id: u.id, role: 'guest' })
      }
    }
    if (actorUserId) this.d.social.assertLinkedFriends(actorUserId, seats)
    for (const p of seats) this.addParticipant(id, p)

    this.d.store.appendEvent(id, null, 'plan.created', {
      title: this.d.store.getPlan(id)!.title,
      intent: parsed.intent_text,
      kind: parsed.kind,
      ask: parsed.ask,
      participants: seats.length,
      deadline_at: deadline.toISOString(),
    })
    return { plan: this.mustPlan(id) }
  }

  addParticipant(
    planId: string,
    p: { name: string; user_id?: string; contact?: string; role?: 'organizer' | 'guest' },
  ): string {
    const id = newParticipantId()
    this.d.store.insertParticipant({
      id,
      plan_id: planId,
      user_id: p.user_id ?? null,
      display_name: p.name.trim(),
      contact: p.contact ?? null,
      role: p.role ?? 'guest',
      responded_at: null,
    })
    this.d.store.appendEvent(planId, id, 'participant.invited', { name: p.name, role: p.role ?? 'guest' })
    return id
  }

  // -------------------------------------------------------------------------
  // Signals
  // -------------------------------------------------------------------------

  /**
   * Record one participant's answer. Signals are append-only, so changing your
   * mind is a new row rather than an edit — "she said 6, then moved to 8" has
   * to stay readable on the timeline.
   */
  async submitSignal(participantId: string, payload: SignalPayload): Promise<void> {
    const parsed = SignalPayloadSchema.parse(payload)
    const p = this.d.store.participant(participantId)
    if (!p) throw new UserError('no such participant', 404)
    const plan = this.mustPlan(p.plan_id)
    if (PLAN_TERMINAL.has(plan.status)) throw new UserError('this plan is closed')

    this.d.store.appendSignal(plan.id, p.id, parsed.kind, parsed)
    if (!p.responded_at) {
      this.d.store.casParticipant(p.id, p.version, { responded_at: this.now().toISOString() })
    }
    // Amounts stay off the timeline for budgets — a group does not need to see
    // who has the smallest ceiling, only that the ranking respected it.
    this.d.store.appendEvent(plan.id, p.id, `signal.${parsed.kind}`, {
      name: p.display_name,
      ...summarySignal(parsed),
    })

    // Ranking is recomputed on every read, so most signals need nothing here.
    // A LOCATION is different: it moves the centroid the venue search runs
    // around, so the board itself is stale until we search again — and that has
    // to keep working after the first batch exists, or the third person to
    // answer never influences where the group looks.
    //
    // But Overpass is a donated public service and a burst of answers would
    // otherwise fire one query per person within seconds. So we only re-search
    // when the group's centre of gravity has actually MOVED enough to change
    // the answer. A second person round the corner from the first does not.
    if (parsed.kind === 'location' && !PLAN_TERMINAL.has(plan.status) && this.readyForOptions(plan.id)) {
      if (this.searchCentreMoved(plan.id)) {
        await this.generateOptions(plan.id).catch(() => undefined)
      }
    }
  }

  /** How far the centroid may drift before the shortlist is worth redoing. */
  private static readonly RESEARCH_THRESHOLD_KM = 1.5

  /**
   * True when the current group centroid is far enough from the one the board
   * was last built around to plausibly change which venues come back.
   */
  private searchCentreMoved(planId: string): boolean {
    const options = this.d.store.options(planId)
    if (options.length === 0) return true // nothing to preserve; always try

    const slots = SlotsSchema.parse(JSON.parse(this.mustPlan(planId).slots_json))
    const anchor = this.searchAnchor(planId, slots)
    if (!anchor.place) return false

    // The board's own centre of gravity, from the venues actually on it.
    const placed = options
      .map((o) => (o.place_json ? (JSON.parse(o.place_json) as Place) : null))
      .filter((p): p is Place => !!p)
    if (placed.length === 0) return true

    return haversineKm(centroid(placed), anchor.place) > PlanService.RESEARCH_THRESHOLD_KM
  }

  /** Enough signal to be worth spending someone's rate limit on. */
  private readyForOptions(planId: string): boolean {
    const participants = this.d.store.participants(planId)
    const responded = participants.filter((p) => p.responded_at).length
    return responded >= Math.min(2, participants.length)
  }

  // -------------------------------------------------------------------------
  // Options
  // -------------------------------------------------------------------------

  /**
   * Fill the board with real candidates. Venue plans hit OpenStreetMap around
   * the group's actual centre of gravity; product plans hit the storefront
   * search or resolve a pasted URL. Every option keeps the raw source response
   * so the UI can show where it came from.
   */
  async generateOptions(planId: string): Promise<PlanOptionRow[]> {
    const plan = this.mustPlan(planId)
    if (PLAN_TERMINAL.has(plan.status)) throw new UserError('this plan is closed')
    const slots = SlotsSchema.parse(JSON.parse(plan.slots_json))
    const kind = plan.kind === 'open' ? this.inferKind(slots) : plan.kind

    const found: OptionInput[] = []
    let note = ''

    if (kind === 'venue') {
      const anchor = this.searchAnchor(planId, slots)
      if (!anchor.place) {
        note = anchor.reason
      } else {
        // anchor.radius_m has ALREADY taken the stated radius into account and
        // widened it to cover the group's real spread. Re-reading slots here
        // would silently discard that: radius_m carries a schema default, so
        // `slots.radius_m ?? anchor.radius_m` can never fall through, and a
        // group spread across a city would be searched at the default 8 km.
        const radius = anchor.radius_m
        const category = await this.resolveCategoryText(slots.category ?? plan.intent_text)
        const res = await this.d.places.search({
          near: anchor.place,
          category,
          radius_m: radius,
          limit: MAX_OPTIONS,
        })
        note = res.reason ?? `${res.venues.length} places within ${Math.round(radius / 1000)} km of ${anchor.place.label}`
        for (const v of res.venues) {
          found.push({
            source: 'overpass',
            title: v.name,
            subtitle: v.place.address ?? v.cuisine,
            place: v.place,
            when: null,
            // OSM knows where a restaurant is, never what dinner costs. An
            // invented price here would be the exact kind of confident
            // fabrication this whole design refuses.
            price: null,
            url: v.website ?? v.osm_url,
            image_url: null,
            raw: v as unknown as Record<string, unknown>,
          })
        }
      }
    }

    if (kind === 'product') {
      if (slots.url) {
        const resolved = await this.d.catalog.resolve(slots.url)
        if (resolved.product) {
          const p = resolved.product
          found.push({
            source: 'url',
            title: p.title,
            subtitle: p.merchant.name,
            place: null,
            when: null,
            price: { ...p.price, basis: 'per_person' },
            url: p.product_url,
            image_url: p.images[0] ?? p.image_url ?? null,
            raw: p as unknown as Record<string, unknown>,
          })
        }
        note = resolved.warnings[0] ?? `read from ${resolved.strategy}`
      } else {
        const res = await this.d.catalog.search(slots.category ?? plan.intent_text, { limit: MAX_OPTIONS })
        note = `${res.products.length} products from ${res.sources.filter((s) => s.count > 0).map((s) => s.label).join(', ') || 'no source'}`
        for (const p of res.products) {
          found.push({
            source: 'shopify',
            title: p.title,
            subtitle: p.merchant.name,
            place: null,
            when: null,
            price: { ...p.price, basis: 'per_person' },
            url: p.product_url,
            image_url: p.image_url ?? null,
            raw: p as unknown as Record<string, unknown>,
          })
        }
      }
    }

    // An option keeps ONLY a time its source actually knows — a real showtime,
    // a booking window. We used to stamp the group's best common window onto
    // timeless venues so time_fit had something concrete to score. That was
    // wrong twice over: it dressed a restaurant up as though it had a fixed
    // sitting, and it froze that guess at whatever the first responder happened
    // to say, because options are not regenerated on every later answer.
    //
    // The ranker already handles a timeless option properly — it falls back to
    // the CURRENT best common window and says so in its `why`. Recomputed on
    // every read it is always right; a stamp is only right for an instant.

    // An empty result must NEVER destroy a working board. Overpass is a shared
    // free service: it rate-limits, it times out, it sheds load. Clearing first
    // and inserting second means one bad minute wipes everyone's options and
    // the group is left staring at nothing. Keep what we had and say why the
    // refresh came back empty.
    const existing = this.d.store.options(planId)
    if (found.length === 0 && existing.length > 0) {
      this.d.store.appendEvent(planId, null, 'options.refresh_empty', {
        kept: existing.length,
        note: note || 'the venue search came back empty',
      })
      return existing
    }

    this.d.store.clearOptions(planId)
    const rows: PlanOptionRow[] = []
    for (const o of found.slice(0, MAX_OPTIONS)) {
      const parsedOption = OptionInputSchema.parse(o)
      const row: PlanOptionRow = {
        id: newOptionId(),
        plan_id: planId,
        source: parsedOption.source,
        title: parsedOption.title,
        subtitle: parsedOption.subtitle ?? null,
        place_json: parsedOption.place ? JSON.stringify(parsedOption.place) : null,
        when_json: parsedOption.when ? JSON.stringify(parsedOption.when) : null,
        price_json: parsedOption.price ? JSON.stringify(parsedOption.price) : null,
        url: parsedOption.url ?? null,
        image_url: parsedOption.image_url ?? null,
        raw_json: JSON.stringify(parsedOption.raw ?? {}),
        created_at: this.now().toISOString(),
      }
      this.d.store.insertOption(row)
      rows.push(row)
    }

    if (rows.length > 0 && plan.status === 'gathering') {
      this.d.store.casPlan(plan.id, plan.version, { status: 'options' })
    }
    this.d.store.appendEvent(planId, null, 'options.generated', {
      count: rows.length,
      kind,
      note,
    })
    return rows
  }

  /** Options plus the arithmetic that ordered them. */
  ranked(planId: string) {
    const plan = this.mustPlan(planId)
    const options = this.d.store.options(planId).map(toOptionInput)
    const participants = this.rankParticipants(planId)
    const scores = rankOptions(options, participants, { now: this.now() })
    const byId = new Map(this.d.store.options(planId).map((o) => [o.id, o]))
    return {
      plan,
      best_windows: this.commonWindows(planId),
      options: scores.map((s) => ({ option: viewOption(byId.get(s.id)!), score: s.score })),
    }
  }

  private rankParticipants(planId: string): RankParticipant[] {
    const participants = this.d.store.participants(planId)
    const signals = this.d.store.currentSignals(planId)
    return participants.map((p) => ({
      id: p.id,
      name: p.display_name,
      signals: signals
        .filter((s) => s.participant_id === p.id)
        .map((s) => JSON.parse(s.payload_json) as SignalPayload),
    }))
  }

  commonWindows(planId: string) {
    const participants = this.rankParticipants(planId)
    return bestCommonWindows(
      participants.map((p) => {
        const a = p.signals.find((s) => s.kind === 'availability')
        return {
          id: p.id,
          windows: a && a.kind === 'availability' ? a.windows : [],
          anytime: a && a.kind === 'availability' ? a.anytime : false,
        }
      }),
      { minDurationMs: 60 * 60 * 1000, limit: 3 },
    )
  }

  /**
   * Where to search. Everyone's stated location beats the organiser's anchor,
   * because the whole point is a place that works for the group rather than
   * for whoever opened the app.
   */
  private searchAnchor(planId: string, slots: Slots): { place: Place | null; radius_m: number; reason: string } {
    const locations = this.rankParticipants(planId)
      .flatMap((p) => p.signals.filter((s) => s.kind === 'location'))
      .map((s) => (s.kind === 'location' ? s.place : null))
      .filter((p): p is Place => !!p)

    if (locations.length > 0) {
      const c = centroid(locations)
      // Big enough to reach everyone, never smaller than the stated radius.
      const spread = boundingRadiusM(locations)
      return {
        place: {
          label: locations.length === 1 ? locations[0]!.label : `between ${locations.length} people`,
          lat: c.lat,
          lng: c.lng,
          source: 'manual',
        },
        radius_m: Math.max(slots.radius_m ?? 8_000, Math.round(spread * 1.3)),
        reason: '',
      }
    }
    if (slots.where) return { place: slots.where, radius_m: slots.radius_m ?? 8_000, reason: '' }
    return {
      place: null,
      radius_m: slots.radius_m ?? 8_000,
      reason: 'Nobody has shared a location yet, and the plan has no anchor — so there is nowhere to search around.',
    }
  }

  /**
   * Free text → a category the venue search understands.
   *
   * The keyword table answers first and answers most of the time; it is exact,
   * free, and offline. Only when it misses entirely — "somewhere to watch the
   * match", "a place to hang after exams" — is a small model asked to pick one
   * of the same 21 ids. It is constrained to that enum, so the worst outcome is
   * the wrong real category rather than an invented one, and with no key the
   * behaviour is exactly what it is today: fall through to a name search.
   */
  private async resolveCategoryText(text: string): Promise<string> {
    const direct = resolveCategory(text)
    if (direct) return direct.id
    const guessed = await classifyCategory(text).catch(() => null)
    return guessed ?? text
  }

  private inferKind(slots: Slots): 'venue' | 'product' {
    if (slots.url) return 'product'
    return 'venue'
  }

  // -------------------------------------------------------------------------
  // Decision → GMP/1
  // -------------------------------------------------------------------------

  chooseOption(planId: string, optionId: string): PlanRow {
    const plan = this.mustPlan(planId)
    if (PLAN_TERMINAL.has(plan.status)) throw new UserError('this plan is closed')
    const option = this.d.store.option(optionId)
    if (!option || option.plan_id !== planId) throw new UserError('no such option', 404)
    if (!this.d.store.casPlan(plan.id, plan.version, { chosen_option_id: optionId, status: 'deciding' })) {
      throw new UserError('the plan moved while you were choosing — try again', 409)
    }
    this.d.store.appendEvent(planId, null, 'option.chosen', { option_id: optionId, title: option.title })
    return this.mustPlan(planId)
  }

  /**
   * The handover. Everything the coordination phase learned becomes an
   * ordinary GMP/1 group: a cart, members, a policy, a deadline. From here the
   * protocol engine owns it and this layer never touches it again.
   */
  async convertToGroup(
    planId: string,
    opts: {
      unit_amount?: number
      qty?: number
      currency?: string
      policy?: unknown
      deadline_minutes?: number
      tolerance_bps?: number
      no_blame?: boolean
      title?: string
    } = {},
  ) {
    const plan = this.mustPlan(planId)
    if (plan.group_id) throw new UserError('this plan already became a group')
    if (!plan.chosen_option_id) throw new UserError('choose an option first')
    const option = this.d.store.option(plan.chosen_option_id)
    if (!option) throw new UserError('the chosen option no longer exists', 404)

    // Only people who said they are in get a seat and a bill.
    const participants = this.d.store.participants(planId)
    const signals = this.d.store.currentSignals(planId)
    const isOut = new Set(
      signals
        .filter((s) => s.kind === 'rsvp' && !(JSON.parse(s.payload_json) as { in: boolean }).in)
        .map((s) => s.participant_id),
    )
    const going = participants.filter((p) => !isOut.has(p.id))
    if (going.length === 0) throw new UserError('nobody is going')

    const price = option.price_json
      ? (JSON.parse(option.price_json) as { amount_minor: number; currency: string; basis: string })
      : null
    const currency = opts.currency ?? price?.currency ?? 'USD'
    const unit = opts.unit_amount ?? price?.amount_minor ?? 0
    if (unit <= 0) {
      // OSM knows the restaurant, not the bill. Rather than guess, the group is
      // sent to the bill splitter once they have a real total.
      throw new UserError(
        'this option has no price attached — enter the amount, or split the real bill once you have it',
      )
    }
    const qty = opts.qty ?? going.length

    const place = option.place_json ? (JSON.parse(option.place_json) as Place) : null

    // Which rail can actually carry this, decided by where the option came
    // from rather than by whether its URL happens to parse.
    //
    // A place from OpenStreetMap is a point on a map, not a merchant Prava can
    // charge — and its `url` may well be the OSM node page or the restaurant's
    // brochure site, neither of which takes payment. Letting that resolve to
    // the card rail would put a group on a path that ends in a charge that
    // cannot happen. A storefront product we resolved from a real merchant
    // page is a different matter, and keeps the card rail.
    const rail: Rail = option.source === 'overpass' ? 'at_venue' : 'prava_mandates'
    // Card rail needs a chargeable merchant URL. Venue rail uses the OSM page
    // (or the restaurant site) so the group header never links to venue.local.test.
    const merchantUrl =
      rail === 'prava_mandates'
        ? safeUrl(option.url ?? '')
        : option.url && /^https?:\/\//i.test(option.url)
          ? option.url
          : ''
    const cart: Cart = {
      items: [
        {
          sku: `plan-${option.id}`,
          name: option.title,
          unit_amount: unit,
          qty,
          tier: 'core',
          claimants: ['mi_all'],
          contested: false,
        } satisfies CartItem,
      ],
      fees: [],
      currency,
    }

    const { group, members } = this.d.groups.createGroup({
      title: opts.title ?? plan.title,
      merchant: {
        id: option.source,
        // Title is the venue/product. Subtitle is often a street or merchant
        // brand — using it as the merchant *name* made Koramangala dinners
        // show up as "Mahayogi Vemana Road" on the group page and receipt.
        name: option.title,
        url: merchantUrl || 'https://venue.local.test',
        country_code_iso2: place?.country_code?.slice(0, 2).toUpperCase() || 'IN',
      },
      cart,
      members: going.map((p) => ({
        name: p.display_name,
        role: 'payer' as const,
        weight: 1,
        user_id: p.user_id ?? undefined,
      })),
      policy: (opts.policy as never) ?? { type: 'all_of' },
      tolerance_bps: opts.tolerance_bps ?? 500,
      straggler_policy: 'retry_once',
      no_blame: opts.no_blame ?? false,
      deadline_minutes: opts.deadline_minutes ?? 60,
      display_currencies: ['INR', 'EUR', 'GBP'],
      auction_window_seconds: 60,
      created_by: plan.created_by ?? undefined,
      circle_id: plan.circle_id ?? undefined,
      origin: 'plan',
      rail,
      product: {
        plan_id: plan.id,
        option_id: option.id,
        source: option.source,
        place,
        url: option.url,
      },
    })

    const fresh = this.mustPlan(planId)
    this.d.store.casPlan(fresh.id, fresh.version, { status: 'converted', group_id: group.id, rail: group.rail })
    this.d.store.appendEvent(planId, null, 'plan.converted', {
      group_id: group.id,
      rail: group.rail,
      members: members.length,
    })
    return { group, members }
  }

  cancelPlan(planId: string, reason = 'cancelled by organiser'): void {
    const plan = this.mustPlan(planId)
    if (PLAN_TERMINAL.has(plan.status)) return
    if (this.d.store.casPlan(plan.id, plan.version, { status: 'cancelled' })) {
      this.d.store.appendEvent(planId, null, 'plan.cancelled', { reason })
    }
  }

  /** Poller tick: a plan nobody answered eventually stops asking. */
  expireIfDue(planId: string): void {
    const plan = this.d.store.getPlan(planId)
    if (!plan || PLAN_TERMINAL.has(plan.status)) return
    if (this.now() < new Date(plan.deadline_at)) return
    if (this.d.store.casPlan(plan.id, plan.version, { status: 'expired' })) {
      this.d.store.appendEvent(planId, null, 'plan.expired', { at: plan.deadline_at })
    }
  }

  mustPlan(id: string): PlanRow {
    const p = this.d.store.getPlan(id)
    if (!p) throw new UserError(`plan ${id} not found`, 404)
    return p
  }
}

// ---------------------------------------------------------------------------

function toOptionInput(o: PlanOptionRow): OptionInput & { id: string } {
  return {
    id: o.id,
    source: o.source,
    title: o.title,
    subtitle: o.subtitle ?? undefined,
    place: o.place_json ? JSON.parse(o.place_json) : null,
    when: o.when_json ? JSON.parse(o.when_json) : null,
    price: o.price_json ? JSON.parse(o.price_json) : null,
    url: o.url,
    image_url: o.image_url,
    raw: JSON.parse(o.raw_json) as Record<string, unknown>,
  }
}

export function viewOption(o: PlanOptionRow) {
  return {
    option_id: o.id,
    source: o.source,
    title: o.title,
    subtitle: o.subtitle,
    place: o.place_json ? JSON.parse(o.place_json) : null,
    when: o.when_json ? JSON.parse(o.when_json) : null,
    price: o.price_json ? JSON.parse(o.price_json) : null,
    url: o.url,
    image_url: o.image_url,
  }
}

/** What the timeline is allowed to say about a signal. Budgets stay private. */
function summarySignal(s: SignalPayload): Record<string, unknown> {
  switch (s.kind) {
    case 'rsvp': return { in: s.in }
    case 'availability': return { windows: s.anytime ? 'anytime' : s.windows.length }
    case 'location': return { label: s.place.label }
    case 'budget': return { set: true } // never the number
    case 'vote': return { option_id: s.option_id, score: s.score }
    case 'constraint': return { text: s.text }
  }
}

function titleFrom(intent: string): string {
  const first = intent.trim().split(/[.!?\n]/)[0] ?? intent
  return first.length > 70 ? `${first.slice(0, 67)}…` : first || 'Untitled plan'
}

/** createGroup requires a URL; a placeholder keeps at_venue off the card rail. */
function safeUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url
  return 'https://venue.local.test'
}
