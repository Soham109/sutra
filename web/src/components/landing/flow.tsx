import { money } from '@/lib/format'

/**
 * The fronting problem drawn as two topologies of the same $268.00 cart.
 * The ink carries the argument: a dashed line is a promise between friends,
 * a solid indigo line is money actually moving at the card network. The
 * "after" diagram has no dashed lines in it, which is the whole product.
 */

// The same four people as the hero replay; kept local so this stays a server component.
const CAST = [
  { first: 'Ada', color: '#2E2AD8' },
  { first: 'Ben', color: '#0F6C8C' },
  { first: 'Cleo', color: '#7A2E8E' },
  { first: 'Dev', color: '#8A6D0B' },
]

const SHARE = 6700
const TOTAL = 26800

/** n lines fanning from evenly spaced tiles above into a single point below. */
function Wires({ n, kind }: { n: number; kind: 'promise' | 'money' }) {
  return (
    <svg className="l-wires" width="400" height="56" viewBox="0 0 400 56" aria-hidden>
      {Array.from({ length: n }, (_, i) => {
        const x = (((i + 0.5) / n) * 400).toFixed(1)
        return <path key={i} data-k={kind} d={`M ${x} 2 C ${x} 30, 200 26, 200 54`} />
      })}
    </svg>
  )
}

function Tile({
  kind,
  color,
  name,
  amount,
  tag,
  solo,
}: {
  kind: 'promise' | 'payer' | 'merchant'
  color?: string
  name: string
  amount: string
  tag: string
  solo?: boolean
}) {
  return (
    <div className={solo ? 'l-tile l-tile-solo' : 'l-tile'} data-k={kind}>
      <span
        className="l-dot"
        style={{ background: color ?? 'var(--ink-3)', borderRadius: kind === 'merchant' ? 3 : undefined }}
        aria-hidden
      />
      <span className="l-tile-name">{name}</span>
      <span className="l-tile-amt amount">{amount}</span>
      <span className="l-tile-tag">{tag}</span>
    </div>
  )
}

function Merchant() {
  return (
    <div className="l-row-solo">
      <Tile kind="merchant" name="sablewood.co" amount={money(TOTAL)} tag="paid in full" solo />
    </div>
  )
}

export function FrontingFlows() {
  return (
    <>
      <div className="l-flows">
        <div className="card l-flow">
          <div className="l-flow-head">
            <span className="eyebrow">Today</span>
            <div className="l-flow-title">One card moves. Three promises don’t.</div>
            <p className="l-flow-sub">Ada taps once and becomes the group’s lender.</p>
          </div>

          <div className="l-row">
            {CAST.slice(1).map((m) => (
              <Tile key={m.first} kind="promise" color={m.color} name={m.first} amount={money(SHARE)} tag="owes ada" />
            ))}
          </div>
          <Wires n={3} kind="promise" />
          <div className="l-row-solo">
            <Tile kind="payer" color={CAST[0].color} name="Ada" amount={money(TOTAL)} tag="on her card" solo />
          </div>
          <Wires n={1} kind="money" />
          <Merchant />
          <p className="l-flow-sub" style={{ marginTop: 14 }}>
            Ada is carrying <span className="amount">{money(20100)}</span> of other people’s money on an unsecured,
            unpriced, unenforceable loan. A split app can format that debt. It cannot undo it.
          </p>
        </div>

        <div className="card l-flow">
          <div className="l-flow-head">
            <span className="eyebrow">With sutra</span>
            <div className="l-flow-title">Four cards move. Nothing is promised.</div>
            <p className="l-flow-sub">Four mandates, one commit window, no creditor.</p>
          </div>

          <div className="l-row">
            {CAST.map((m) => (
              <Tile key={m.first} kind="payer" color={m.color} name={m.first} amount={money(SHARE)} tag="own card" />
            ))}
          </div>
          <Wires n={4} kind="money" />
          <Merchant />
          <p className="l-flow-sub" style={{ marginTop: 14 }}>
            Each share is charged to the person who owes it, capped at their own number and enforced at the card
            network. When the group settles, nobody is holding anybody’s money.
          </p>
        </div>
      </div>

      <div className="l-legend">
        <span>
          <svg width="26" height="8" aria-hidden>
            <path d="M1 4h24" stroke="var(--brand)" strokeWidth="2" strokeLinecap="round" />
          </svg>
          money moving at the card network
        </span>
        <span>
          <svg width="26" height="8" aria-hidden>
            <path d="M1 4h24" stroke="var(--ink-3)" strokeWidth="1.5" strokeDasharray="4 4" />
          </svg>
          a promise between friends
        </span>
      </div>
    </>
  )
}

/** What the engine actually wrote down when Ada's backstop caught Cleo's share. */
export function BackstopLedger() {
  const rows: { k: string; v: string; n: string; kind?: string }[] = [
    { k: 'cleo.share', v: money(SHARE), n: 'declined · mandate cancelled', kind: 'drop' },
    { k: 'ada.backstop_cap', v: money(7500), n: 'armed before approvals opened' },
    { k: 'ada.mandate', v: `${money(SHARE)} → ${money(13400)}`, n: 'raised, still under cap', kind: 'raise' },
    { k: 'pooled_funds', v: money(0), n: 'there is no pool to draw on' },
    { k: 'group.total', v: money(TOTAL), n: 'unchanged · 3 cards · one window', kind: 'total' },
  ]

  return (
    <div className="l-ledger">
      {rows.map((r) => (
        <div className="l-lrow" data-k={r.kind} key={r.k}>
          <span className="l-lk">{r.k}</span>
          <span className="l-lv">{r.v}</span>
          <span className="l-ln">{r.n}</span>
        </div>
      ))}
    </div>
  )
}
