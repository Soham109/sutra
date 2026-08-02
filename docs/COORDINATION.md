# The coordination layer

How a group gets from *"dinner saturday?"* to a concrete, priced, agreed thing.

This layer is **not part of GMP/1**. The protocol begins when a group already
knows what it is buying; this is the hour before that, made into an object. It
hands over exactly once, through `convertToGroup`, and never touches the group
again. See [`spec/PROTOCOL.md`](../spec/PROTOCOL.md) §11 for the boundary and
the handover contract.

Source: [`engine/src/plan/`](../engine/src/plan/) (`types.ts`, `service.ts`,
`store.ts`, `rank.ts`, `time.ts`, `geo.ts`, `opening-hours.ts`), with venue
discovery in [`engine/src/places/`](../engine/src/places/) and intent
extraction in [`engine/src/agent/extract.ts`](../engine/src/agent/extract.ts).

---

## 1. The shape of a plan

Deliberately vertical-neutral. *"Movie with friends"*, *"dinner Saturday"*,
*"four tickets at this URL"* and *"split this restaurant bill"* are the same
object with different slots filled and a different option source. There is no
movie code path. Adding a vertical means adding an option source, not a branch.

```
free text
   │  agent/extract.ts   (LLM optional; the deterministic pass always runs)
   ▼
SLOTS          category · when{earliest,latest,hint} · where · radius_m
               party_size · budget_ceiling_minor · currency · url · notes
   │
   ▼
PARTICIPANTS ──► SIGNALS ──► OPTIONS ──► rank.ts ──► the group picks one
                                                         │
                                                         ▼
                                                  convertToGroup()
```

`kind ∈ {venue, product, bill, open}` decides which option source answers.
`open` is inferred at generation time: a URL in the slots means `product`,
otherwise `venue`.

Status: `gathering → options → deciding → converted`, with exits to `cancelled`
and `expired`. `converted`, `cancelled` and `expired` are terminal.

### The extractor's job is small on purpose

A model may propose slots. It never picks a venue, never sets a price, never
decides who pays what, and never emits a coordinate — the extractor reports a
place *phrase* and a real geocoder resolves it. Everything downstream is
arithmetic over data from named sources, so a hallucinated slot shows up as an
obviously wrong search rather than as a wrong charge.

The deterministic extractor is not a stub for when the key is missing; it is
the floor. With no network and no key, *"dinner with Arsh and Maya around 8pm
saturday near Koramangala, under 800 each"* still parses. When
`OPENAI_API_KEY` is set the model pass runs first and the deterministic pass
still runs underneath it, supplying the concrete date arithmetic and acting as
a floor under anything the model declined to fill in. Any model failure falls
back silently — a model outage must never be the reason a group cannot plan
dinner.

Currency is the one place where an inference is allowed, and it is bounded:
if the sentence names a currency, that wins. If it gives a bare number
(*"under 800"*) and a **real geocoder** reports the country, the country's
everyday currency is used and the substitution is recorded as an uncertainty
the user is shown. Moving an amount between currencies with different
minor-unit exponents is a **rescale, not a conversion** — "three thousand yen"
is 3000 minor units, not 300000 — and no exchange rate is applied or implied.

---

## 2. The signal model

One generic mechanism. *"When are you free"* is not a movie feature, it is an
`availability` signal; adding *"what's your dietary constraint"* is a
`constraint` signal, not a new subsystem.

| Kind | Payload | Notes |
|---|---|---|
| `rsvp` | `{ in: boolean }` | in or out |
| `availability` | `{ windows: TimeWindow[], anytime: boolean }` | up to 20 windows. `anytime: true` is categorically different from sending no windows |
| `location` | `{ place: Place }` | where they would travel *from* |
| `budget` | `{ ceiling_minor, currency }` | the most they will pay for their share |
| `vote` | `{ option_id, score ∈ {-1,0,+1}, note? }` | deliberately coarse: a nudge, not a decision |
| `constraint` | `{ text }` | something the ranking must respect but cannot score |

Every `Place` carries a `source` — `nominatim`, `overpass`, `device`, `manual`,
`merchant` — so the UI can say where a coordinate came from. No lat/lng in this
system is ever a model's guess.

**Signals are append-only.** Changing your mind is a new row, not an edit:
*"she said 6, then moved to 8"* has to stay readable on the timeline. The
*latest* row per `(participant, kind)` is current — except votes, which key on
`(participant, kind, option_id)` because one person holds one vote per option.

**Privacy.** The plan timeline records that a budget was set, never the number
(`{ set: true }`). A group does not need to see who has the smallest ceiling,
only that the ranking respected it. The plan view lists, per participant, which
questions they have answered, their RSVP, and the *label* of the location they
gave — deliberately not their availability windows and never their budget. The
ranker sees all of it; the board does not.

**When options get fetched.** Generating options spends someone else's rate
limit, so it is not done on every keystroke. A new `location`, `availability`
or `rsvp` signal triggers generation only once at least `min(2, n)`
participants have responded, and only while the plan is still `gathering`.
`POST /v1/plans/:id/options/refresh` is the explicit manual trigger. At most
**8** options go on the board — more than that is noise, not choice.

---

## 3. Finding a common time

[`engine/src/plan/time.ts`](../engine/src/plan/time.ts). Pure: no I/O, no clock
reads — `now` is always passed in by the caller.

### Representation

Every window is **half-open `[start, end)`**: the instant `end` is not in the
window. That is what makes 18:00–20:00 and 20:00–22:00 two adjacent slots
rather than two slots that both own 20:00, and it is why merging touching
intervals (`next.start <= cur.end`) is correct rather than sloppy.

Internally everything is epoch milliseconds. ISO-8601 strings are parsed once
on the way in and formatted once on the way out; no comparison is ever done on
strings, because `2026-08-01T12:00:00Z` and `2026-08-01T14:00:00+02:00` are the
same instant with different bytes. A window that cannot be parsed is dropped,
not guessed at.

### `bestCommonWindows` — the boundary sweep

Availability only ever changes at an instant where somebody's window starts or
ends. Take every such instant, sort them, and the timeline is cut into
**elementary segments** between consecutive boundaries. Inside a segment no
window begins or ends, so the set of available participants is constant
throughout it — testing the segment's start answers for the whole segment.

That is the entire correctness argument, and it is why we do not intersect
participants pairwise: the sweep computes the availability of all *n*
participants over the whole timeline in one pass, **O(W log W)** for W total
windows (the sort dominates), instead of O(n²) list intersections that still
would not tell you who is in each resulting slot.

Each segment is painted with a bitmask of who covers it. A candidate window is
then grown from each segment: extend left and right while the neighbouring
segment's mask is a **superset** of this one's — every member of the set is
still free there. Growth stops at the first segment missing somebody, and gaps
stop it too (an empty segment is a superset of no non-empty set), so the result
is contiguous by construction. The set available across the grown window is
exactly the segment's own mask, which is why everybody listed can genuinely
make the *whole* window and why deduplicating on the `(lo, hi)` range is safe.

**Who counts:**

- `anytime: true` participants are available for every candidate, and are
  deliberately kept *out* of the sweep so they contribute no boundaries — a
  person who is free always must not be able to invent a meeting slot.
- Participants who sent nothing are **never** counted as available. They appear
  in `unavailable`, so the caller can see who it is still waiting on.
- If nobody sent a concrete window, the result is `[]` rather than an invented
  slot. With only "anytime" answers there is no evidence about *when* to meet.

**Ordering:** most people first, then the longest slot, then the earliest, with
a final deterministic tiebreak on input order. The plan service asks for
windows of at least **1 hour** and keeps the top **3**.

Supporting operations, all exported and tested: `normalise`, `intersect`,
`windowDurationMs`, `totalDurationMs`, `overlapMs`, `coversInstant`,
`coversWindow`.

---

## 4. The geography

[`engine/src/plan/geo.ts`](../engine/src/plan/geo.ts). Pure.

**Distance** is great-circle (haversine) on a sphere of radius
`6371.0088 km` — the IUGG mean. The `asin` form is used with its argument
clamped to 1, which is the numerically stable variant: floating-point error can
push `sqrt(h)` a hair above 1 for antipodal points, which would produce `NaN`.

That is a deliberate modelling choice, not an approximation being hidden.
Spherical distances differ from the WGS84 ellipsoid by up to ~0.5%. Nobody
travels along a great circle anyway — real road or transit distance is
typically 1.2–1.4× the straight line, and that detour factor dwarfs the
ellipsoid error by two orders of magnitude. So these numbers are a fair,
symmetric, cheap proxy for *"how far out of your way is this"*, good enough to
compare options against each other, and never presented as a route. Real travel
time would come from a routing service, not from a better ellipsoid.

**Centroid** projects each point onto the unit sphere in 3D, averages the
Cartesian vectors, and projects back. Not the arithmetic mean of degrees, which
is wrong in two ways that both show up in real groups:

1. Longitude wraps. Averaging +179° and −179° gives 0° — the middle of the
   wrong ocean — when the true midpoint is 180°. Same bug at the prime meridian
   for any group straddling London.
2. A degree of longitude is not a constant distance. At 60°N it is half the
   width it is at the equator, so a degree-space mean silently over-weights the
   northern members of a spread-out group.

If the points cancel out (antipodal pairs, an even spread around a great
circle) the mean vector is ~zero and no direction is meaningful; we fall back
to the first point rather than returning a fabricated coordinate. The caller's
`boundingRadiusM` is then enormous, which is the correct signal that this group
has no useful centre.

**`travelCost(from[], to)`** returns `total_km`, `max_km`, `mean_km` and a
per-origin breakdown, all rounded to 2 dp (10 m) on the way out — so the
numbers a human reads are the exact numbers the score was computed from.
`max_km` exists because fairness is not the average: four people 1 km away and
one person 40 km away have a mean of 8.8 km, which reads as "close by" and
quietly hides the one person crossing the city.

**Where the search is centred.** Everyone's stated location beats the
organiser's anchor, because the point is a place that works for the group
rather than for whoever opened the app. Given at least one `location` signal,
the anchor is the spherical centroid of those locations, labelled *"between N
people"*. With no location signals the plan's own `where` slot is used. With
neither, **no search runs at all** and the plan says so: *"Nobody has shared a
location yet, and the plan has no anchor — so there is nowhere to search
around."*

**On the radius, since this document is meant to be checkable.** `searchAnchor`
computes a spread-aware radius — `max(slots.radius_m, round(boundingRadiusM(locations)
× 1.3))`, big enough to reach everybody's neighbourhood — and `generateOptions`
uses that value (`anchor.radius_m`) directly rather than re-reading
`slots.radius_m`. That distinction matters because `radius_m` carries a schema
default of **8000 m**: re-reading it as `slots.radius_m ?? anchor.radius_m`
would never fall through to the spread-aware value (the default fills in
first), silently searching a city-spread group at the default 8 km. Both are
in [`plan/service.ts`](../engine/src/plan/service.ts), with a comment at the
call site recording exactly this reasoning so the next person who "simplifies"
it does not reintroduce the bug.

---

## 5. Real options

An option with no traceable source is a bug, not a suggestion. Every option
keeps the exact response that produced it in `raw_json`.

| Source | Where it comes from |
|---|---|
| `overpass` | a real place from OpenStreetMap, with real coordinates and every tag OSM had |
| `shopify` | a real product from a storefront's own search |
| `url` | a real merchant page read directly |
| `manual` | typed in by a human, who owns the numbers |

### OpenStreetMap, treated as donated infrastructure

[`engine/src/places/`](../engine/src/places/). Keyless, global, no account.
Nominatim geocodes; Overpass finds venues. Both are volunteer-funded shared
resources, and the code treats them that way:

- A process-wide rate gate — **1100 ms** for Nominatim (its policy caps clients
  at one request per second *absolutely*, and 1100 gives clock skew room),
  **250 ms** for Overpass, which asks clients not to run queries in parallel.
- An application-identifying `User-Agent`, which both policies make mandatory.
- A host allowlist, HTTPS enforced, redirects **refused** rather than followed
  (a redirect off an OSM endpoint is a signal something is wrong), and a 4 MB
  response cap.
- A 10-minute in-memory cache, bounded at 200 entries.
- Reachability is reported **as last observed, never as probed**. Pinging a
  donated endpoint to render a status dot is exactly the traffic their usage
  policy asks us not to send.

Failure never throws into the request path. It becomes an empty list plus a
`reason` string that is rendered verbatim: *"Overpass is rate-limiting us; try
again in a minute"*, *"Nominatim did not answer in time"*. A plan board that
says that is honest; one that 500s because a free tile server hiccuped is not.

Two details worth stating because they are where this would normally go wrong:

- Overpass reports server-side trouble as **HTTP 200 with a `remark` and an
  empty element list.** Any remark on a plain venue query means the answer is
  incomplete, and an incomplete answer rendered as "nothing near you" is the
  one lie this module must not tell — so a remark is treated as a failure and
  the mirror is tried.
- Free text maps to OSM tags through a hand-checked taxonomy
  ([`places/taxonomy.ts`](../engine/src/places/taxonomy.ts)); every tag was
  checked against the OSM wiki, because a *guessed* tag returns zero venues and
  looks exactly like "there is nothing near you". When a category is not
  recognised we say so and fall back to a name search rather than silently
  ranking the wrong kind of place.

An unnamed OSM node is dropped: it is a data point, not somewhere a human can
agree to meet. Results are re-sorted nearest-first, because Overpass returns
them in database order.

**OSM knows where a restaurant is. It never knows what dinner costs.** Venue
options therefore carry `price: null`, and inventing one here would be the exact
kind of confident fabrication this design refuses. That is why a venue plan
cannot convert to a group without someone supplying the amount.

---

## 6. The ranker

[`engine/src/plan/rank.ts`](../engine/src/plan/rank.ts). Pure: no I/O, no clock
reads.

The contract that keeps this honest: `score` is a pure function of
`(option, signals)` and the UI renders each factor's `why` sentence **verbatim**.
There is no hidden term and no model gets a vote in the ordering. Three rules
follow from that, and the file obeys them without exception.

> **1. No hidden terms.** The score is exactly the weighted mean of the factors
> that carry weight. A factor that could not be computed gets **weight 0** and
> a `why` saying why — a factor quietly contributing a guessed 0.5 would be a
> lie the UI cannot catch.
>
> **2. Every curve is linear and stated.** "12.5 km of a 25 km ceiling scores
> 0.5" is checkable in your head. A logistic would be smoother and
> unverifiable, so it is not here.
>
> **3. Silence is never agreement.** A participant who sent no signal is never
> counted as a yes.

### Weights

They sum to 1.00, so a weight reads directly as "this is N% of the score".

| Factor | Weight | Why that weight |
|---|---:|---|
| `time_fit` | **0.35** | If people cannot make it, nothing else matters. The only factor that can be a hard no for a whole group. |
| `travel_fit` | **0.25** | The most common reason a plan quietly dies. |
| `budget_fit` | **0.25** | Equal to travel: money and distance are the two real costs, and neither should dominate the other. |
| `preference` | **0.10** | Votes are deliberately coarse (−1/0/+1), so they break ties rather than decide. |
| `freshness` | **0.05** | A tie-breaker. Its real job is the hard exclusion of past options, which does not run through the weight at all. |

Weights are overridable per call and are returned to the UI, so what you are
shown is what was used.

```
score = Σ (valueᵢ × weightᵢ)  /  Σ weightᵢ        over factors with weight > 0
      = null                                       if every weight is 0
```

Clamped to [0,1] and rounded to 3 dp. `null` means "we know nothing about this
option yet", which sorts *after* everything that has a number.

### Who the score is about

Anyone who RSVP'd **out** is excluded from every denominator — their
availability and budget are no longer the group's problem. If nobody has RSVP'd
in yet, the score is computed against everyone still in play rather than
against an empty set, and every affected sentence says so: *"(nobody has RSVP'd
yet, so everyone is counted)"*.

### The five factors

#### `time_fit` — 0.35

If the option carries a fixed `when`, the value is
`|who can make it| / |who shared availability|`, measured against that exact
window (a participant must cover the *whole* window, not overlap it).

If the option has no fixed time — which is every OSM venue — it is scored
against the best common window the group could actually agree on, and the
sentence says plainly that that is what happened:

> *No fixed time on this option, so it is scored against the best common slot
> instead: 2026-08-08 20:00–22:30 UTC (2h 30m) suits 3 of 3 who shared
> availability.*

**Missing signal:** a participant with no availability is dropped from *both*
sides of the fraction and counted in the sentence (*"; 2 of 5 have not shared
times"*). An `availability` signal carrying neither `anytime` nor any window
tells us nothing and is treated as unanswered rather than as "free never". If
*nobody* has shared availability, the factor is **unscored at weight 0**.

#### `travel_fit` — 0.25

```
fit(km)  = clamp(1 − km / maxAcceptableKm, 0, 1)        maxAcceptableKm = 25 by default
value    = 0.5 × mean(fit(kmᵢ)) + 0.5 × fit(max kmᵢ)
```

Linear, so 0 km scores 1.0, half the ceiling scores 0.5, and anything at or
beyond the ceiling scores 0 — all re-derivable from the kilometre figures
printed next to it. 25 km is roughly "across a large city"; it is overridable,
because a road trip and a lunch have different ceilings.

The 50/50 blend of the *average* trip and the *worst* trip is the fairness
term. The mean alone hides the outlier: four people at 1 km and one at 40 km
average to 8.8 km, which reads "nearby" while one person crosses the city. An
even split means one bad trip can cost at most half the factor and can never be
averaged away entirely.

Note that we average the **fits, not the distances**. Past the ceiling the
clamp bites, and averaging distances first would let a 100 km outlier drag
everyone's score below zero-clamped truth.

**Missing signal:** a participant with no location signal is not travelling
anywhere as far as we know, so they are left out of the calculation and counted
in the sentence (*"over 3 who shared a location (2 did not)"*). No location
signals at all, or an option with no place, → **unscored at weight 0**.

#### `budget_fit` — 0.25

```
perPerson = basis === 'total' ? ceil(price / headcount) : price
value     = |budgets ≥ perPerson| / |comparable budgets shared|
```

`headcount` is the attending set. The sentence prints the division:
*"USD 240.00 total ÷ 4 people = USD 60.00 each; within 2 of 3 shared budgets"*.

**Currency is never coerced.** A EUR ceiling and a USD price are not comparable
without a rate we do not have, so mismatched budgets are dropped from the
arithmetic and named explicitly: *"2 budgets in EUR could not be compared with a
USD price and were left out."*

**Missing signal:** no budget means not counted. The denominator is the people
who actually named a ceiling, and it is printed, so a `1/1` is never mistaken
for unanimity — the sentence also states how many shared nothing. A price with
`basis: 'unknown'` is **unscored at weight 0**: we do not know whether it is per
person or for the whole group, so it is not compared with anyone's ceiling. No
price at all → unscored.

#### `preference` — 0.10

```
value = (mean vote + 1) / 2          all −1 → 0 · all neutral → 0.5 · all +1 → 1
```

Monotone: a mean can never exceed +1, so adding another +1 never lowers it.
A −1 gets called out by name in the sentence, because *"a −1 is somebody saying
no, not just a point off the total"*.

**Missing signal:** a non-voter is **not** a neutral vote. Neutral (0) is
something a person chose; silence is not, and folding the two together would
let one enthusiastic +1 be diluted by six people who never opened the link. No
votes at all → unscored at weight 0.

#### `freshness` — 0.05

```
starts in the future   → 1
already under way      → (end − now) / (end − start)
wholly in the past     → 0, AND hard-excluded (below)
```

**Missing signal:** no `when` means there is nothing to age, so weight 0 rather
than a fabricated penalty. Options without times are not stale, they are
unscheduled.

### Why "silence is not agreement" is implemented as it is

The shared rule is that a silent participant is dropped from that factor's
**denominator** — they neither approve nor veto an option they said nothing
about — and their absence is stated in the sentence. Overall `confidence` is a
separate number that carries the "we have barely heard from anyone" warning.

The obvious alternative, counting the silent as a `no`, was rejected on
purpose: it penalises every option identically, so it changes no ordering while
making every displayed fraction misleading.

### Confidence

```
confidence = |participants who sent any signal| / |invited participants|
```

Over **invited** participants, not attending ones: it answers "how much of this
group have we actually heard from", and someone who RSVP'd *out* has still told
us something.

### Hard exclusions

An excluded option is still scored and still returned by the API, and the board
**keeps it visible, marked `Ruled out — <reason>`** rather than letting it
vanish (`web/src/components/plan/option-card.tsx`). The group gets to see that
the cheap place was ruled out by somebody's dietary constraint. Checked in
order, first match wins:

1. **In the past** — *"This is in the past — it ended 3h ago, at …"*. A low
   freshness score alone would still let a dead option outrank a live one on
   the other four factors, so this is an exclusion rather than a penalty.
2. **Above every shared budget** — only when at least one comparable budget
   exists and none of them covers the per-person price. The sentence prints
   the option's own (public) price and how many budgets were compared, and
   deliberately stops there: it never names the highest individual ceiling or
   whose it was, because that would leak the exact number `summarySignal`
   keeps off the timeline elsewhere ("never the number"). An earlier version
   of this sentence did print it, attributed to a named participant — found
   and fixed while auditing this file for the same leak.
3. **Closed the whole proposed window** — see "Opening hours" below.
4. **Contradicts a stated constraint** — see below.

### Opening hours

[`engine/src/plan/opening-hours.ts`](../engine/src/plan/opening-hours.ts). A
venue that is provably shut for the entire time a group is proposing to meet
must not win — this is the single most common way a "great recommendation"
turns out to be useless, and OSM's `opening_hours` tag is exactly the fact
that would have caught it.

The module is a small hand-written parser, not a dependency: the full OSM
grammar covers public holidays, month/week ranges, sunrise/sunset, quoted
comments and a fallback-rule operator, and getting the uncommon 5% subtly
wrong is a worse outcome than admitting we don't understand it. It confidently
handles day selectors (`Mo-Fr`, `Sa,Su`, wrapping ranges like `Fr-Mo`), time
ranges including split shifts (`11:00-15:00,19:00-23:00`), overnight spans
(`18:00-02:00`), `24/7`, and `off`/`closed` overriding a general rule for one
day (`Mo-Su 09:00-18:00; Su off`). Anything it does not confidently recognise
— `PH off`, a stray comment, a typo'd time — makes the **whole spec** unknown
rather than trusting the half it parsed; a half-understood schedule is not
meaningfully safer to act on than an unread one.

**Timezone.** OSM's `opening_hours` is wall-clock time at the venue, with no
timezone of its own. Like the rest of `plan/`, this module works entirely in
UTC instants, so the proposed window's UTC clock time is read *as* the
venue's local time — correct when the group and the venue share a timezone
(the overwhelming common case), silently off by the UTC offset otherwise.
Nothing in this codebase tracks a per-place timezone today; that is an
inherited limitation, not a new one.

**What it does with the result.** Checked against the *reference window* —
the same window `time_fit` above scores against, whether that is the option's
own fixed `when` or the group's best common slot. Zero overlap between the
venue's stated hours and that window is a hard exclusion: *"This is closed
during 2026-08-08 19:00–21:00 UTC — its listed hours are 'Mo-Fr
09:00-22:00'."* Partial overlap (open for some of the window, not all of it)
is **not** excluded — the group can still meet in the part that is open — but
appends a checkable note to `time_fit`'s own sentence: *"It is only open 1h of
that 2h window — its listed hours are 'Sa 19:00-22:00'."* An option with no
`opening_hours` tag, or one whose spec could not be parsed, gets neither the
note nor the exclusion — silence about a venue's hours is honest; a wrong
guess about them is not.

### Constraint matching, deliberately timid

A constraint is free text (*"vegetarian"*, *"no alcohol please"*) and an
option's `raw` is whatever its source returned — for Overpass, OSM tags. We
exclude **only on an explicit contradiction**: a tag that is present and
carries a value that flatly rules the constraint out.

The asymmetry is the reason: a wrongly excluded option disappears from the
board and nobody ever learns it existed, while a wrongly included one is voted
down in ten seconds. So we never infer from a tag's *absence* (an untagged
restaurant is not assumed to be meat-only), never guess from the title, and
never act on a negated mention — *"no outdoor seating"* must not be read as a
request for outdoor seating.

| Constraint terms | Contradicted by |
|---|---|
| vegetarian, veggie, no meat, meat free | `diet:vegetarian=no`, `cuisine=steak_house\|barbecue\|bbq\|seafood` |
| vegan | `diet:vegan=no` |
| halal | `diet:halal=no` |
| kosher | `diet:kosher=no` |
| gluten, coeliac, celiac | `diet:gluten_free=no` |
| no alcohol, alcohol free, sober, teetotal, non-alcoholic | `amenity=bar\|pub\|nightclub\|biergarten`, `alcohol=only` |
| wheelchair, step free, accessible | `wheelchair=no` |
| no smoking, non-smoking, smoke free | `smoking=yes` |
| outdoor, outside, patio, terrace, al fresco | `outdoor_seating=no` |

Three of those rows encode a judgement worth spelling out. There is no bare
`alcohol` term, because "alcohol" alone may well be a request *for* it — only
unambiguous abstinence phrasings select that rule. `smoking=dedicated` means a
separate smoking room exists, which does not contradict "no smoking" for our
participant, so only `smoking=yes` (permitted throughout) does. And a term
preceded by a negator (`no`, `not`, `non`, `without`, `avoid`, `except`, …) is
refused rather than matched — terms that are themselves negative, like *no
alcohol*, are exempt from that check, since they *are* the negation.

Tags are read from both `raw.tags` (Overpass elements) and the top level, and
semicolons are honoured as OSM's list separator, so `cuisine=pizza;italian`
matches either value.

### Ordering

Live options before excluded ones; then by score descending; unscorable
(`null`) options after scored ones; then input order, which for OSM venues is
nearest-first. Excluded options are **returned, never dropped**.

---

## 7. Ties, near-misses, and what changed

A ranked list always has a first row, whether or not the arithmetic behind it
is decisive. Three small, pure, separately-tested functions in `rank.ts` exist
so the board says that plainly instead of implying a confidence it does not
have.

### Near-ties

`summariseRanking(scored)` flags live (non-excluded, scored) options within
**`NEAR_TIE_EPSILON` (0.05)** of the best live score. Most factors are
fractions over a handful of people — one more or fewer RSVP can swing a factor
by 0.1–0.33 — so anything within 0.05 of the top score is well inside the
noise of a single participant's next answer; presenting a definite winner
there overstates the arithmetic's precision. `ranked()` returns both a
plan-level `near_ties: string[]` (option ids) and a per-option `near_tie:
boolean`, so a client can render "tied for first" without recomputing the
threshold itself. A tie is never reported for fewer than two options.

### The strongest rejected option

The same function finds the best-**scoring** option among those that got hard
excluded, and returns it as `strongest_rejected: { id, score, reason }`. "You
would have loved this, but it's closed" is a more useful answer than letting
that option quietly settle to the bottom of the board next to places nobody
would have picked anyway — excluded options are already sorted last (see
Ordering, above), so without this a genuinely strong runner-up is
indistinguishable in position from the worst option on the list.

### Explaining a re-rank

`ranked()` recomputes from scratch on every read — the board is always
correct — but "correct" and "explained" are different things. A group that
refreshes the page to find an option has quietly climbed from 3rd to 1st has
no way to know whether that is a bug or somebody just became free.

`PlanService.submitSignal` takes a snapshot of the board's order (`rankSnapshot`)
**before** the new signal is recorded and another one **after**, and
`diffRankings` (pure, in `rank.ts`) compares them. A move is only reported
when: the option existed in both snapshots (a wholesale board regeneration is
a new board, already narrated by its own `options.generated` event, not a
"move"); it was genuinely scored (non-`null`) on both sides (going from
"unranked" to "ranked" is the *initial* ranking, not something that moved);
and either its old or new rank is within the top 3 — a shuffle entirely below
the fold is not worth narrating. At most 3 moves are reported per signal,
biggest jump first.

For each move, `reasonForMove` tries to name the *specific* thing that changed
for the participant who just answered — checked against their own
`per_participant` row on that option (did `time_ok`, `budget_ok` or their
`vote` flip?) before falling back to an honest, generic description of what
kind of signal arrived ("Maya shared when they can make it"). The result is
appended to the plan's timeline as an `options.reranked` event carrying
`option_id`, `title`, `from_rank`, `to_rank`, `reason`, and a ready-to-render
`summary` from `describeMove`: *"Sablewood moved from 3rd to 1st — Maya can
now make it."*

---

## 8. Per-participant detail

Alongside the aggregate, every option carries a row per participant:
`time_ok`, `travel_km`, `budget_ok`, `vote` — each of which is `null` when
that participant said nothing, so *"why am I not going"* has an answer that
distinguishes "you can't make it" from "you never told us".

`time_ok` is measured against the reference window — the option's own `when` if
it has one, otherwise the best common slot the factor was scored against — so
the row and the sentence above it always agree.

---

## 9. What this layer refuses to do

- It never invents a coordinate, a price, or a venue.
- It never counts silence as agreement.
- It never converts between currencies.
- It never hides an option it excluded.
- It never claims a source answered when it did not — a dark source is a
  sentence on the board, not an empty list pretending to be an answer.
- It never decides. `chooseOption` is a human action, and `convertToGroup`
  needs a real number from a human before a single mandate is minted.
- It never guesses a venue's opening hours, or half-trusts a schedule it only
  partly understood — see "Opening hours" in §6.
