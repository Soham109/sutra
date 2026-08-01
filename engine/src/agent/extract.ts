import { SlotsSchema, type PlanKind, type Slots } from '../plan/types.js'

// ---------------------------------------------------------------------------
// Free text → structured intent.
//
// The model's job here is deliberately small: read a sentence and fill slots.
// It never picks a venue, never sets a price, never decides who pays what.
// Everything downstream — ranking, shares, caps, commit — is arithmetic over
// data from named sources, so a hallucinated slot shows up as an obviously
// wrong search rather than as a wrong charge.
//
// The deterministic extractor is not a stub for when the key is missing. It is
// the floor: with no network and no key, "dinner with Arsh and Maya around 8pm
// saturday near Koramangala, under 800 each" still parses correctly.
// ---------------------------------------------------------------------------

export interface Extraction {
  title: string
  kind: PlanKind
  slots: Slots
  /** names mentioned as participants, best effort */
  people: string[]
  /** which signals this plan should ask each person for */
  ask: ('rsvp' | 'availability' | 'location' | 'budget' | 'constraint')[]
  source: 'openai' | 'deterministic'
  /** anything the extractor was unsure about; shown to the human to confirm */
  uncertainties: string[]
}

const CATEGORY_WORDS: [RegExp, string][] = [
  [/\b(movie|movies|cinema|film|screening|showtime)\b/i, 'cinema'],
  [/\b(dinner|lunch|brunch|eat|restaurant|food|meal|dine)\b/i, 'restaurant'],
  [/\b(coffee|cafe|café)\b/i, 'cafe'],
  [/\b(drinks?|bar|pub|beer|cocktails?)\b/i, 'bar'],
  [/\b(club|clubbing|nightclub|party)\b/i, 'nightclub'],
  [/\b(bowling)\b/i, 'bowling'],
  [/\b(concert|gig|live music)\b/i, 'concert'],
  [/\b(hotel|stay|airbnb|room)\b/i, 'hotel'],
  [/\b(museum|gallery|exhibit)\b/i, 'museum'],
  [/\b(gym|workout|climbing)\b/i, 'gym'],
  [/\b(karaoke)\b/i, 'karaoke'],
  [/\b(arcade|gaming)\b/i, 'arcade'],
  [/\b(park|picnic)\b/i, 'park'],
]

/** Currency symbol/code → ISO 4217. Symbol wins over the ambient default. */
const CURRENCY_HINTS: [RegExp, string][] = [
  [/₹|\brs\.?\b|\binr\b|\brupees?\b/i, 'INR'],
  [/£|\bgbp\b|\bpounds?\b/i, 'GBP'],
  [/€|\beur\b|\beuros?\b/i, 'EUR'],
  [/\$|\busd\b|\bdollars?\b|\bbucks?\b/i, 'USD'],
  [/\baed\b|\bdirhams?\b/i, 'AED'],
  [/\bsgd\b/i, 'SGD'],
  [/¥|\bjpy\b|\byen\b/i, 'JPY'],
]

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

/**
 * Deterministic extraction. Every rule here is one a human can predict, which
 * is the point: the fallback has to be trustworthy enough to demo on.
 */
export function extractDeterministic(text: string, now = new Date()): Extraction {
  const uncertainties: string[] = []
  const lower = text.toLowerCase()

  const category = CATEGORY_WORDS.find(([re]) => re.test(text))?.[1]
  const currency = CURRENCY_HINTS.find(([re]) => re.test(text))?.[1] ?? 'USD'

  // A pasted link is the strongest possible signal about what this is.
  const url = /(https?:\/\/[^\s<>"']+)/i.exec(text)?.[1]

  // "under 800 each", "₹800 per person", "max $25", "budget 30"
  const budget = matchBudget(text)
  if (budget === null && /\b(budget|under|max|cheap|afford)\b/i.test(text)) {
    uncertainties.push('A budget was mentioned but no number could be read from it.')
  }

  // "with Arsh and Maya", "me, Dev and Soham", "@handles"
  const people = extractPeople(text)

  const when = extractWhen(text, now)
  if (!when.earliest && /\b(tonight|tomorrow|today|weekend|saturday|sunday|later|soon)\b/i.test(lower)) {
    uncertainties.push('A time was mentioned but could not be pinned to a date — confirm it below.')
  }

  // "near Koramangala", "in Shoreditch", "around Bandra"
  const whereLabel = /\b(?:near|around|in|at|by)\s+([A-Z][\w'’.-]*(?:\s+[A-Z][\w'’.-]*){0,3})/.exec(text)?.[1]
  if (whereLabel) {
    // Geocoding happens in the service, against a real geocoder. The extractor
    // only reports the phrase — it must never invent coordinates.
    uncertainties.push(`Looking up "${whereLabel}" as the area to search around.`)
  }

  const partySize = matchPartySize(text) ?? (people.length ? people.length + 1 : undefined)

  const kind: PlanKind = url ? 'product' : category ? 'venue' : 'open'

  const slots = SlotsSchema.parse({
    category: category ?? undefined,
    when: {
      earliest: when.earliest,
      latest: when.latest,
      hint: when.hint,
    },
    where: null, // resolved by the geocoder, never guessed here
    party_size: partySize,
    budget_ceiling_minor: budget ?? undefined,
    currency,
    url,
    notes: whereLabel ? `search near: ${whereLabel}` : undefined,
  })

  const ask: Extraction['ask'] = ['rsvp']
  if (!when.exact) ask.push('availability')
  if (kind === 'venue') ask.push('location')
  ask.push('budget')

  return {
    title: titleOf(text),
    kind,
    slots,
    people,
    ask,
    source: 'deterministic',
    uncertainties,
  }
}

/** The phrase to geocode, if the sentence named a place. Service resolves it. */
export function locationPhrase(text: string): string | null {
  return /\b(?:near|around|in|at|by)\s+([A-Z][\w'’.-]*(?:\s+[A-Z][\w'’.-]*){0,3})/.exec(text)?.[1] ?? null
}

/** True when the text names a currency outright, so nothing may override it. */
export function statedCurrency(text: string): string | null {
  return CURRENCY_HINTS.find(([re]) => re.test(text))?.[1] ?? null
}

/**
 * Country → its everyday currency. Used only when the sentence gave a bare
 * number ("under 800") and a real geocoder told us where that number was
 * spoken. "800" near Koramangala is 800 rupees, and rendering it as $800 is
 * the kind of quiet wrongness that destroys trust in a money product.
 */
const COUNTRY_CURRENCY: Record<string, string> = {
  IN: 'INR', US: 'USD', GB: 'GBP', AE: 'AED', SG: 'SGD', JP: 'JPY', AU: 'AUD',
  CA: 'CAD', NZ: 'NZD', CH: 'CHF', SE: 'SEK', NO: 'NOK', DK: 'DKK', PL: 'PLN',
  ZA: 'ZAR', BR: 'BRL', MX: 'MXN', ID: 'IDR', MY: 'MYR', TH: 'THB', PH: 'PHP',
  VN: 'VND', KR: 'KRW', CN: 'CNY', HK: 'HKD', TR: 'TRY', SA: 'SAR', NG: 'NGN',
  KE: 'KES', EG: 'EGP', IL: 'ILS', LK: 'LKR', BD: 'BDT', PK: 'PKR', NP: 'NPR',
  DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', IE: 'EUR', PT: 'EUR',
  AT: 'EUR', BE: 'EUR', FI: 'EUR', GR: 'EUR',
}

export function currencyForCountry(countryCode?: string): string | null {
  if (!countryCode) return null
  return COUNTRY_CURRENCY[countryCode.toUpperCase()] ?? null
}

// ---------------------------------------------------------------------------

function matchBudget(text: string): number | null {
  // Anchored on budget language so "4 tickets" and "8pm" never read as money.
  const re =
    /(?:under|below|max(?:imum)?|budget(?:\s+of)?|up\s+to|no\s+more\s+than|around|about)\s*(?:[₹$£€]|rs\.?|inr|usd|gbp|eur)?\s*(\d[\d,]*(?:\.\d{1,2})?)|(?:[₹$£€]|rs\.?)\s*(\d[\d,]*(?:\.\d{1,2})?)\s*(?:each|per\s+(?:person|head)|pp)/i
  const m = re.exec(text)
  if (!m) return null
  const raw = m[1] ?? m[2]
  if (!raw) return null
  const n = Number(raw.replace(/,/g, ''))
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.round(n * 100)
}

function matchPartySize(text: string): number | undefined {
  const m = /(\d+)\s*(?:people|of us|persons?|pax|tickets?|seats?|heads?)\b/i.exec(text)
  if (m?.[1]) {
    const n = Number(m[1])
    if (n > 0 && n <= 50) return n
  }
  const words: Record<string, number> = {
    two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  }
  const w = /\b(two|three|four|five|six|seven|eight|nine|ten)\s+(?:people|of us|tickets?|seats?)\b/i.exec(text)
  const key = w?.[1]?.toLowerCase()
  return key ? words[key] : undefined
}

function extractPeople(text: string): string[] {
  const out = new Set<string>()

  // @handles are unambiguous.
  for (const m of text.matchAll(/@([a-z0-9_.-]{2,30})/gi)) out.add(m[1]!)

  // "with A, B and C" — only the span after "with", so a capitalised place
  // name elsewhere in the sentence is not mistaken for a person.
  const withSpan = /\bwith\s+([^.?!\n]*)/i.exec(text)?.[1]
  if (withSpan) {
    const stop = /\b(?:at|near|in|on|around|tonight|tomorrow|today|under|for|about|by)\b/i
    const span = withSpan.split(stop)[0] ?? withSpan
    for (const chunk of span.split(/,|\band\b|&/i)) {
      const name = chunk.trim().replace(/[^\w'’ -]/g, '')
      if (!name) continue
      if (/^(me|my|myself|us|everyone|the|friends?|guys|team)$/i.test(name)) continue
      if (name.length < 2 || name.length > 30) continue
      // Require a capital: "with the boys" should not become a person.
      if (!/^[A-Z]/.test(name)) continue
      out.add(name)
    }
  }
  return [...out]
}

interface WhenGuess {
  earliest?: string
  latest?: string
  hint?: string
  /** true when the text named a specific enough time to skip the availability poll */
  exact: boolean
}

/**
 * Dates are resolved relative to `now` in the server's zone. Anything vaguer
 * than a named day stays unset — an availability poll is a better answer than
 * a confident guess at what "soon" means.
 */
function extractWhen(text: string, now: Date): WhenGuess {
  const lower = text.toLowerCase()
  const hint = /\b(tonight|tomorrow night|tomorrow|today|this weekend|weekend|next week|(?:mon|tues|wednes|thurs|fri|satur|sun)day(?:\s+(?:evening|night|morning|afternoon))?)\b/i
    .exec(lower)?.[0]

  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
  let day: Date | null = null

  if (/\btonight\b|\btoday\b/.test(lower)) day = startOfDay(now)
  else if (/\btomorrow\b/.test(lower)) day = new Date(startOfDay(now).getTime() + 86_400_000)
  else {
    const named = DAYS.findIndex((d) => new RegExp(`\\b${d}\\b`).test(lower))
    if (named >= 0) {
      const delta = (named - now.getDay() + 7) % 7 || 7 // "saturday" on a Saturday means next one
      day = new Date(startOfDay(now).getTime() + delta * 86_400_000)
    } else if (/\bweekend\b/.test(lower)) {
      const delta = (6 - now.getDay() + 7) % 7 // Saturday
      day = new Date(startOfDay(now).getTime() + delta * 86_400_000)
    }
  }
  if (!day) return { hint, exact: false }

  // "at 8", "8pm", "20:30", "half past seven" is out of scope on purpose.
  const t = /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i.exec(text)
  let hour: number | null = null
  let minute = 0
  if (t?.[1]) {
    const h = Number(t[1])
    const mer = t[3]?.toLowerCase()
    minute = t[2] ? Number(t[2]) : 0
    if (h >= 0 && h <= 23 && minute >= 0 && minute < 60) {
      hour = mer === 'pm' && h < 12 ? h + 12 : mer === 'am' && h === 12 ? 0 : h
      // A bare small number with no meridiem and no colon is more likely a
      // count ("4 tickets") than a time; require evidence.
      if (!mer && !t[2] && !/\b(?:at|around|by)\s+\d/i.test(text)) hour = null
    }
  }
  if (/\bnight\b|\bevening\b/.test(lower) && hour === null) hour = 19
  if (/\bmorning\b/.test(lower) && hour === null) hour = 10
  if (/\bafternoon\b/.test(lower) && hour === null) hour = 14

  if (hour === null) {
    // A day but no time: the whole day is the envelope, and we still ask.
    return {
      earliest: day.toISOString(),
      latest: new Date(day.getTime() + 86_400_000).toISOString(),
      hint,
      exact: false,
    }
  }
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute)
  return {
    earliest: start.toISOString(),
    latest: new Date(start.getTime() + 3 * 3_600_000).toISOString(),
    hint,
    exact: true,
  }
}

function titleOf(text: string): string {
  const t = text.trim().split(/[\n.!?]/)[0]?.trim() ?? text.trim()
  const clean = t.replace(/\s+/g, ' ')
  return clean.length > 70 ? `${clean.slice(0, 67)}…` : clean || 'New plan'
}

// ---------------------------------------------------------------------------
// LLM extraction — same output shape, better at messy sentences.
// ---------------------------------------------------------------------------

const EXTRACTION_TOOL = {
  type: 'function' as const,
  function: {
    name: 'record_intent',
    description: 'Record the structured reading of a group plan request.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string', description: 'Short human title, max 70 chars' },
        kind: { type: 'string', enum: ['venue', 'product', 'bill', 'open'] },
        category: {
          type: 'string',
          description: 'Kind of place or thing, e.g. cinema, restaurant, bar, hotel. Empty if unclear.',
        },
        people: {
          type: 'array',
          items: { type: 'string' },
          description: 'Names of other people mentioned. Do not invent names.',
        },
        party_size: { type: 'integer' },
        budget_ceiling_minor: {
          type: 'integer',
          description: 'Per-person budget in MINOR units (cents/paise). Omit if not stated.',
        },
        currency: { type: 'string', description: 'ISO 4217, inferred from symbol or context' },
        location_phrase: {
          type: 'string',
          description: 'The place name to search around, exactly as written. Never coordinates.',
        },
        when_hint: { type: 'string', description: 'The time phrase exactly as written' },
        url: { type: 'string', description: 'A product or merchant URL if one appears' },
        uncertainties: {
          type: 'array',
          items: { type: 'string' },
          description: 'Anything ambiguous, phrased as a short sentence for the user to confirm.',
        },
      },
      required: ['title', 'kind'],
    },
  },
}

export async function extractWithOpenAI(
  key: string,
  text: string,
  now = new Date(),
): Promise<Extraction> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? 'gpt-4.1-nano',
      temperature: 0,
      tools: [EXTRACTION_TOOL],
      tool_choice: { type: 'function', function: { name: 'record_intent' } },
      messages: [
        {
          role: 'system',
          content:
            'You read one sentence describing a group outing or group purchase and record its structure. ' +
            'Rules you must not break: never invent a venue, a price, a merchant or a coordinate; ' +
            'record only what the text says. If the text does not state something, omit the field. ' +
            'Money is recorded in minor units (cents/paise). ' +
            `The current date-time is ${now.toISOString()}.`,
        },
        { role: 'user', content: text },
      ],
    }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`openai ${res.status}`)
  const data = (await res.json()) as {
    choices: { message: { tool_calls?: { function: { arguments: string } }[] } }[]
  }
  const args = data.choices[0]?.message?.tool_calls?.[0]?.function?.arguments
  if (!args) throw new Error('openai returned no tool call')
  const parsed = JSON.parse(args) as Record<string, unknown>

  // The deterministic pass still runs: it supplies the concrete date maths and
  // acts as a floor under anything the model declined to fill in.
  const base = extractDeterministic(text, now)
  const slots = SlotsSchema.parse({
    ...base.slots,
    category: (parsed.category as string) || base.slots.category,
    party_size: (parsed.party_size as number) ?? base.slots.party_size,
    budget_ceiling_minor:
      (parsed.budget_ceiling_minor as number) ?? base.slots.budget_ceiling_minor,
    currency: (parsed.currency as string) || base.slots.currency,
    url: (parsed.url as string) || base.slots.url,
    notes: parsed.location_phrase ? `search near: ${parsed.location_phrase}` : base.slots.notes,
    when: { ...base.slots.when, hint: (parsed.when_hint as string) || base.slots.when.hint },
  })

  const people = Array.isArray(parsed.people)
    ? [...new Set((parsed.people as string[]).filter((p) => typeof p === 'string' && p.trim()))]
    : base.people

  return {
    title: ((parsed.title as string) || base.title).slice(0, 70),
    kind: ((parsed.kind as PlanKind) || base.kind),
    slots,
    people,
    ask: base.ask,
    source: 'openai',
    uncertainties: Array.isArray(parsed.uncertainties)
      ? (parsed.uncertainties as string[]).slice(0, 5)
      : base.uncertainties,
  }
}

/** LLM when a key exists, deterministic otherwise — and on any LLM failure. */
export async function extractIntent(text: string, now = new Date()): Promise<Extraction> {
  const key = process.env.OPENAI_API_KEY
  if (key) {
    try {
      return await extractWithOpenAI(key, text, now)
    } catch {
      // A model outage must never be the reason a group cannot plan dinner.
      return extractDeterministic(text, now)
    }
  }
  return extractDeterministic(text, now)
}
