// Hand-authored inline SVG. No libraries, no images, no network calls — every
// box names a real file or endpoint, and every arrow label is a real trigger
// taken from engine/src/service.ts, types.ts, rails.ts and receipt.ts, not
// from a description of them. Colour is load-bearing, not decorative: the
// same --ok/--warn/--bad tokens the rest of the product uses for
// approved/pending/declined are reused here for committed/partial/aborted,
// so the diagrams read as the same visual language as the app, not a
// separate "docs skin".
//
// Every SVG below is deliberately terse — box titles, one citation line,
// short arrow verbs. The full explanation for each transition lives in the
// prose next to the diagram in page.tsx. That split (structure in the SVG,
// explanation in the text) is what keeps these legible at 390px: nothing in
// the SVG depends on being wide, everything scales as one block.

type Tone = 'default' | 'ok' | 'bad' | 'warn' | 'brand'
type ArrowTone = 'ink2' | 'muted' | 'money' | 'ok' | 'bad' | 'warn'

const TONE_FILL: Record<Tone, string> = {
  default: 'var(--surface)',
  ok: 'var(--ok-soft)',
  bad: 'var(--bad-soft)',
  warn: 'var(--warn-soft)',
  brand: 'var(--brand-soft)',
}
const TONE_STROKE: Record<Tone, string> = {
  default: 'var(--line-2)',
  ok: 'var(--ok-line)',
  bad: 'var(--bad-line)',
  warn: 'var(--warn-line)',
  brand: 'var(--brand-line)',
}
const TONE_TEXT: Record<Tone, string> = {
  default: 'var(--ink)',
  ok: 'var(--ok)',
  bad: 'var(--bad)',
  warn: 'var(--warn)',
  brand: 'var(--brand-ink)',
}
const ARROW_STROKE: Record<ArrowTone, string> = {
  ink2: 'var(--ink-2)',
  muted: 'var(--ink-3)',
  money: 'var(--brand)',
  ok: 'var(--ok)',
  bad: 'var(--bad)',
  warn: 'var(--warn)',
}

/** A box: a bold title, and up to two small muted citation/sub lines. */
function Box({
  x, y, w, h, title, sub, tone = 'default', mono,
}: {
  x: number; y: number; w: number; h: number; title: string
  sub?: string[]; tone?: Tone; mono?: boolean
}) {
  const hasSub = !!sub?.length
  const titleY = hasSub ? y + 18 : y + h / 2 + 4
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={9} fill={TONE_FILL[tone]} stroke={TONE_STROKE[tone]} strokeWidth={1.2} />
      <text x={x + w / 2} y={titleY} textAnchor="middle" fontSize={12.5} fontWeight={650} fill={TONE_TEXT[tone]}>
        {title}
      </text>
      {sub?.map((line, i) => (
        <text
          key={i}
          x={x + w / 2}
          y={titleY + 14.5 + i * 12}
          textAnchor="middle"
          fontSize={9.5}
          fontFamily={mono ? 'var(--font-mono)' : undefined}
          fill="var(--ink-3)"
        >
          {line}
        </text>
      ))}
    </g>
  )
}

/** A plain answer cell: one or two lines of equal-weight text, no title/sub split. */
function Cell({
  x, y, w, h, lines, tone = 'default', mono,
}: { x: number; y: number; w: number; h: number; lines: string[]; tone?: Tone; mono?: boolean }) {
  const startY = y + h / 2 - ((lines.length - 1) * 13) / 2 + 3.5
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={8} fill={TONE_FILL[tone]} stroke={TONE_STROKE[tone]} strokeWidth={1.2} />
      {lines.map((l, i) => (
        <text key={i} x={x + w / 2} y={startY + i * 13} textAnchor="middle" fontSize={10.5} fontWeight={550} fontFamily={mono ? 'var(--font-mono)' : undefined} fill={TONE_TEXT[tone]}>
          {l}
        </text>
      ))}
    </g>
  )
}

/** A straight vertical arrow with a short label to its right. */
function VArrow({
  x, y1, y2, label, tone = 'ink2', dashed, marker,
}: { x: number; y1: number; y2: number; label?: string; tone?: ArrowTone; dashed?: boolean; marker: string }) {
  return (
    <g>
      <line x1={x} y1={y1} x2={x} y2={y2} stroke={ARROW_STROKE[tone]} strokeWidth={tone === 'money' ? 2.25 : 1.4} strokeDasharray={dashed ? '4 3' : undefined} markerEnd={`url(#${marker})`} />
      {label && (
        <text x={x + 10} y={(y1 + y2) / 2 + 3} fontSize={9.5} fill="var(--ink-2)">
          {label}
        </text>
      )}
    </g>
  )
}

/** An elbow/tick connector into a box — used so several boxes can tap one
 * shared trunk instead of drawing crossing diagonal arrows. */
function Elbow({ points, tone = 'ink2', dashed, marker }: { points: string; tone?: ArrowTone; dashed?: boolean; marker: string }) {
  return (
    <polyline
      points={points}
      fill="none"
      stroke={ARROW_STROKE[tone]}
      strokeWidth={tone === 'money' ? 2.25 : 1.4}
      strokeDasharray={dashed ? '4 3' : undefined}
      markerEnd={`url(#${marker})`}
      strokeLinejoin="round"
    />
  )
}

const ARROW_TONES: ArrowTone[] = ['ink2', 'muted', 'money', 'ok', 'bad', 'warn']

function ArrowDefs({ id }: { id: string }) {
  return (
    <defs>
      {ARROW_TONES.map((t) => (
        <marker key={t} id={`${id}-${t}`} viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 Z" fill={ARROW_STROKE[t]} />
        </marker>
      ))}
    </defs>
  )
}

export function Legend({ items }: { items: { swatch: 'money' | 'muted'; label: string }[] }) {
  return (
    <div className="doc-legend">
      {items.map((it) => (
        <span key={it.label} className={`doc-legend-item is-${it.swatch}`}>
          <i /> {it.label}
        </span>
      ))}
    </div>
  )
}

// ===========================================================================
// 1. The system at a glance
// ===========================================================================
export function SystemGlance() {
  const id = 'd1'
  const cx = 175
  const rightEdge = 330
  const trunk = 347
  return (
    <svg viewBox="-4 -6 368 620" role="img" aria-label="Five surfaces send requests to the sutra engine, which reads OpenStreetMap and merchant pages for free, and only moves money through Prava, which is also where a human approves directly with their own passkey.">
      <ArrowDefs id={id} />

      <Box x={20} y={0} w={310} h={38} title="Web app" sub={['web/src/app']} mono />
      <Box x={20} y={46} w={310} h={38} title="Browser extension" sub={['extension/content.js']} mono />
      <Box x={20} y={92} w={310} h={38} title="Bookmarklet" sub={['widget/bookmarklet.js']} mono />
      <Box x={20} y={138} w={310} h={38} title="MCP server (any agent framework)" sub={['mcp/src/server.ts']} mono />
      <Box x={20} y={184} w={310} h={38} title="NANDA Town plugin (Python)" sub={['nanda-town-prava/…/plugin.py']} mono />

      {[19, 65, 111, 157, 203].map((cy) => (
        <line key={cy} x1={rightEdge} y1={cy} x2={trunk} y2={cy} stroke="var(--ink-3)" strokeWidth={1.2} />
      ))}
      <line x1={trunk} y1={19} x2={trunk} y2={236} stroke="var(--ink-3)" strokeWidth={1.2} />
      <Elbow points={`${trunk},236 ${trunk},248 ${cx},248 ${cx},254`} tone="muted" marker={`${id}-muted`} />
      <text x={cx + 10} y={244} fontSize={9.5} fill="var(--ink-2)">one REST contract, no money yet</text>

      <Box x={20} y={254} w={310} h={50} title="sutra engine" sub={['engine/src/service.ts · one process, SQLite']} mono />

      <line x1={rightEdge} y1={279} x2={trunk} y2={279} stroke="var(--ink-3)" strokeWidth={1.2} />
      <line x1={trunk} y1={279} x2={trunk} y2={505} stroke="var(--ink-3)" strokeWidth={1.2} />
      <Elbow points={`${trunk},359 ${rightEdge},359`} tone="muted" marker={`${id}-muted`} />
      <Elbow points={`${trunk},405 ${rightEdge},405`} tone="muted" marker={`${id}-muted`} />
      <Elbow points={`${trunk},505 ${rightEdge},505`} tone="money" marker={`${id}-money`} />

      <Box x={20} y={340} w={310} h={38} title="OpenStreetMap" sub={['GET /v1/places/geocode, /search']} mono />
      <Box x={20} y={386} w={310} h={38} title="Merchant product pages" sub={['POST /v1/discover/resolve']} mono />

      <Box x={20} y={432} w={310} h={36} title="You — your own device, your own passkey" />
      <VArrow x={cx} y1={468} y2={479} label="opens Prava's hosted page" tone="muted" dashed marker={`${id}-muted`} />

      <Box x={20} y={480} w={310} h={50} title="Prava" sub={['POST /v1/sessions → POST /v1/mandates/:id/charge']} mono tone="brand" />

      <VArrow x={cx} y1={530} y2={550} label="money lands" tone="money" marker={`${id}-money`} />
      <Box x={20} y={550} w={310} h={42} title="The merchant" sub={['gets paid — sutra never sees the card number']} tone="ok" />
    </svg>
  )
}

// ===========================================================================
// 2. The life of a group
// ===========================================================================
export function GroupLifecycle() {
  const id = 'd2'
  const cx = 175
  return (
    <svg viewBox="-4 -6 368 906" role="img" aria-label="The group state machine — collecting, committing, committed, with exits to aborted, expired and partial — and the member state machine beneath it.">
      <ArrowDefs id={id} />

      <text x={20} y={12} fontSize={10.5} fontWeight={700} letterSpacing="0.06em" fill="var(--ink-3)">GROUP — types.ts GroupStatus</text>

      <Box x={20} y={22} w={310} h={38} title="collecting" sub={['members approve, decline, or run out the clock']} />
      <VArrow x={cx} y1={60} y2={100} label="policy satisfied" marker={`${id}-ink2`} />
      <Box x={20} y={100} w={310} h={38} title="committing" sub={['first charge call — the point of no return']} />
      <VArrow x={cx} y1={138} y2={178} label="every entry lands" marker={`${id}-ink2`} />
      <Box x={20} y={178} w={310} h={36} title="committed" sub={['terminal — signed receipt issued']} tone="ok" />

      <line x1={20} y1={216} x2={340} y2={216} stroke="var(--line)" strokeWidth={1} strokeDasharray="3 3" />
      <text x={20} y={230} fontSize={10.5} fontWeight={700} letterSpacing="0.06em" fill="var(--ink-3)">EXITS</text>

      <line x1={330} y1={40} x2={347} y2={40} stroke="var(--ink-3)" strokeWidth={1.2} />
      <line x1={347} y1={40} x2={347} y2={320} stroke="var(--ink-3)" strokeWidth={1.2} />
      <Elbow points="347,270 330,270" tone="bad" marker={`${id}-bad`} />
      <Elbow points="347,320 330,320" tone="bad" marker={`${id}-bad`} />

      <line x1={330} y1={119} x2={353} y2={119} stroke="var(--ink-3)" strokeWidth={1.2} />
      <line x1={353} y1={119} x2={353} y2={366} stroke="var(--ink-3)" strokeWidth={1.2} />
      <Elbow points="353,366 330,366" tone="warn" marker={`${id}-warn`} />

      <Box x={20} y={250} w={310} h={40} title="aborted" sub={['policy unsatisfiable, or organizer cancels']} tone="bad" />
      <Box x={20} y={300} w={310} h={40} title="expired" sub={['deadline passed, policy still open']} tone="bad" />
      <Box x={20} y={346} w={310} h={40} title="partial" sub={['straggler policy leaves a mixed outcome']} tone="warn" />

      <line x1={20} y1={402} x2={340} y2={402} stroke="var(--line)" strokeWidth={1} strokeDasharray="3 3" />
      <text x={20} y={416} fontSize={10.5} fontWeight={700} letterSpacing="0.06em" fill="var(--ink-3)">MEMBER — types.ts MemberStatus</text>

      <Box x={20} y={424} w={310} h={30} title="invited" />
      <VArrow x={cx} y1={454} y2={480} label="opens their link" marker={`${id}-ink2`} />
      <Box x={20} y={480} w={310} h={30} title="viewed" />
      <VArrow x={cx} y1={510} y2={536} label="session created / asked directly" marker={`${id}-ink2`} />
      <Box x={20} y={536} w={310} h={34} title="awaiting_approval" />
      <VArrow x={cx} y1={570} y2={596} label="mandate active / acceptShare()" marker={`${id}-ink2`} />
      <Box x={20} y={596} w={310} h={30} title="approved" />
      <VArrow x={cx} y1={626} y2={652} label="charge attempted" marker={`${id}-ink2`} />
      <Box x={20} y={652} w={310} h={30} title="charging" />
      <VArrow x={cx} y1={682} y2={708} label="Prava confirms it landed" marker={`${id}-ink2`} />
      <Box x={20} y={708} w={310} h={34} title="charged" tone="ok" sub={['terminal, charging rail']} />

      <Elbow points="20,605 8,605 8,495 20,495" tone="warn" dashed marker={`${id}-warn`} />
      <Elbow points="20,617 6,617 6,782 20,782" tone="ok" dashed marker={`${id}-ok`} />
      <Box x={20} y={762} w={310} h={40} title="settled (at_venue rail)" sub={['no card touched — deliberately not "charged"']} tone="ok" />

      <Elbow points="330,611 350,611 350,855 330,855" tone="bad" dashed marker={`${id}-bad`} />
      <Box x={20} y={824} w={310} h={62} title="declined · expired · dropped · failed" sub={['reachable from invited through approved', 'never from charged or settled — those are terminal']} tone="bad" />
    </svg>
  )
}

// ===========================================================================
// 3. The commit saga
// ===========================================================================
export function CommitSaga() {
  const id = 'd3'
  const cx = 175
  return (
    <svg viewBox="-4 -6 368 660" role="img" aria-label="The commit saga from a satisfied policy to a signed receipt, including a backstop absorbing a shortfall, a terminal decline, and an unknown outcome that is never treated as a failure.">
      <ArrowDefs id={id} />

      <Box x={20} y={0} w={310} h={38} title="policy satisfied — approver set locked" sub={['lockAndCommit() — service.ts']} mono />
      <VArrow x={cx} y1={38} y2={70} label="shortfall after caps?" marker={`${id}-ink2`} />

      <Box x={20} y={70} w={148} h={44} title="backstop absorbs it" sub={['proportional to each cap']} tone="ok" />
      <Box x={182} y={70} w={148} h={44} title="requote, then abort" sub={['2 rounds max']} tone="warn" />

      <VArrow x={cx} y1={114} y2={148} label="charge(mandate, reference)" tone="money" marker={`${id}-money`} />
      <Box x={20} y={148} w={310} h={38} title="charge the mandate" sub={['POST /v1/mandates/:id/charge — one at a time']} mono tone="brand" />

      <line x1={330} y1={167} x2={347} y2={167} stroke="var(--ink-3)" strokeWidth={1.2} />
      <line x1={347} y1={167} x2={347} y2={334} stroke="var(--ink-3)" strokeWidth={1.2} />
      <Elbow points="347,220 330,220" tone="bad" marker={`${id}-bad`} />
      <Elbow points="347,276 330,276" tone="warn" marker={`${id}-warn`} />
      <Elbow points="347,334 330,334" tone="ok" marker={`${id}-ok`} />

      <Box x={20} y={200} w={310} h={40} title="4xx — a definite no" sub={['no charge exists; straggler policy decides next']} tone="bad" />
      <Box x={20} y={254} w={310} h={44} title="unknown after reconciliation" sub={['never failed — parked; poller resumes it later']} tone="warn" />
      <Box x={20} y={312} w={310} h={44} title="landed" sub={['DB says charged before the slow report lands']} tone="ok" />

      <VArrow x={cx} y1={356} y2={390} label="reportCharge(APPROVED)" marker={`${id}-ink2`} />
      <Box x={20} y={390} w={310} h={40} title="report the settlement" sub={['retried 5× — charge stands even if this never confirms']} />

      <VArrow x={cx} y1={430} y2={460} label="after every entry" marker={`${id}-ink2`} />
      <Box x={20} y={460} w={310} h={38} title="cancel unused mandates" sub={['every authorization that was never charged']} />

      <VArrow x={cx} y1={498} y2={528} marker={`${id}-ink2`} />
      <Box x={20} y={528} w={310} h={38} title="committed or partial" sub={['depends on whether every entry landed']} />

      <VArrow x={cx} y1={566} y2={596} marker={`${id}-ink2`} />
      <Box x={20} y={596} w={310} h={46} title="signed receipt" sub={['Ed25519, hash-chained — rail, owed, charged']} tone="brand" />
    </svg>
  )
}

// ===========================================================================
// 4. The two rails, side by side
// ===========================================================================
export function TwoRails() {
  const id = 'd4'
  const cx = 175
  const col1 = { x: 20, w: 150 }
  const col2 = { x: 180, w: 150 }
  return (
    <svg viewBox="-4 -6 368 554" role="img" aria-label="prava_mandates and at_venue compared row by row, and the verifyReceipt rule that catches a receipt claiming a charge on a rail that cannot charge.">
      <ArrowDefs id={id} />

      <Cell x={col1.x} y={0} w={col1.w} h={32} lines={['prava_mandates']} tone="brand" mono />
      <Cell x={col2.x} y={0} w={col2.w} h={32} lines={['at_venue']} tone="default" mono />

      <text x={20} y={46} fontSize={10} fill="var(--ink-3)">needs a chargeable merchant</text>
      <Cell x={col1.x} y={52} w={col1.w} h={28} lines={['yes']} />
      <Cell x={col2.x} y={52} w={col2.w} h={28} lines={['no']} />

      <text x={20} y={94} fontSize={10} fill="var(--ink-3)">your consent is</text>
      <Cell x={col1.x} y={100} w={col1.w} h={46} lines={['passkey approval,', 'capped & locked']} />
      <Cell x={col2.x} y={100} w={col2.w} h={46} lines={['an explicit yes to', 'an exact number']} />

      <text x={20} y={160} fontSize={10} fill="var(--ink-3)">does the engine move money</text>
      <Cell x={col1.x} y={166} w={col1.w} h={30} lines={['YES']} tone="brand" />
      <Cell x={col2.x} y={166} w={col2.w} h={30} lines={['NO']} tone="ok" />

      <text x={20} y={210} fontSize={10} fill="var(--ink-3)">your terminal status</text>
      <Cell x={col1.x} y={216} w={col1.w} h={28} lines={['charged']} />
      <Cell x={col2.x} y={216} w={col2.w} h={28} lines={['settled']} />

      <text x={20} y={258} fontSize={10} fill="var(--ink-3)">receipt charged_amount</text>
      <Cell x={col1.x} y={264} w={col1.w} h={30} lines={['the amount charged']} />
      <Cell x={col2.x} y={264} w={col2.w} h={30} lines={['always 0']} />

      <text x={20} y={308} fontSize={10} fill="var(--ink-3)">the only verb allowed</text>
      <Cell x={col1.x} y={314} w={col1.w} h={30} lines={['"charged"']} mono />
      <Cell x={col2.x} y={314} w={col2.w} h={30} lines={['"settled at the venue"']} mono />

      <Box x={20} y={366} w={310} h={38} title="a receipt claims" sub={['rail: at_venue, charged_amount: 50000']} mono />
      <VArrow x={cx} y1={404} y2={426} label="verifyReceipt()" marker={`${id}-ink2`} />
      <Box x={20} y={426} w={310} h={34} title="rule 6" sub={['at_venue rail + non-zero charged']} mono />
      <VArrow x={cx} y1={460} y2={478} marker={`${id}-bad`} tone="bad" />
      <Box x={20} y={478} w={310} h={54} title="rejected" tone="bad" sub={['"at_venue receipt reports a charged amount —', 'no card is charged on this rail"']} />
    </svg>
  )
}

// ===========================================================================
// 5. The coordination layer
// ===========================================================================
export function CoordinationLayer() {
  const id = 'd5'
  const cx = 175
  return (
    <svg viewBox="-4 -6 368 486" role="img" aria-label="A sentence becomes slots, then typed signals, then ranked real venues, then a cart, then hands over to the GMP/1 protocol engine, which sits below the boundary of this coordination layer.">
      <ArrowDefs id={id} />

      <Box x={20} y={0} w={310} h={42} title="free text" sub={['"dinner sat near Koramangala, under 900 each"']} mono />
      <VArrow x={cx} y1={42} y2={68} label="agent/extract.ts" marker={`${id}-ink2`} />
      <Box x={20} y={68} w={310} h={44} title="slots" sub={['category · when · where · budget · party size']} />
      <VArrow x={cx} y1={112} y2={138} label="participants answer" marker={`${id}-ink2`} />
      <Box x={20} y={138} w={310} h={44} title="signals" sub={['rsvp · availability · location · budget · vote']} />
      <VArrow x={cx} y1={182} y2={208} label="sources fetch candidates" marker={`${id}-ink2`} />
      <Box x={20} y={208} w={310} h={44} title="options" sub={['overpass (OSM) · storefront search · manual']} />
      <VArrow x={cx} y1={252} y2={278} label="rank.ts — a pure scorer" marker={`${id}-ink2`} />
      <Box x={20} y={278} w={310} h={50} title="ranked options" sub={['5 weighted factors, each with a checkable reason']} />
      <VArrow x={cx} y1={328} y2={354} label="the group picks one" marker={`${id}-ink2`} />
      <Box x={20} y={354} w={310} h={36} title="chosen option" />

      <VArrow x={cx} y1={390} y2={424} label="convertToGroup()" marker={`${id}-ink2`} />
      <line x1={10} y1={408} x2={350} y2={408} stroke="var(--line)" strokeWidth={1} strokeDasharray="3 3" />
      <text x={20} y={404} fontSize={9.5} fill="var(--ink-3)">layer boundary — not part of GMP/1</text>

      <Box x={20} y={424} w={310} h={46} title="GMP/1 protocol engine" sub={['cart + members + policy + rail — protocol owns it now']} tone="brand" />
    </svg>
  )
}
