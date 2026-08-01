'use client'

import { Badge } from '@/components/ui'
import { money } from '@/lib/format'
import { Row, Section, ToggleChip } from './fields'
import { type DraftItem, type DraftMember, claimers, itemTotal } from './model'

export function ClaimsEditor({
  items,
  members,
  currency,
  onItems,
}: {
  items: DraftItem[]
  members: DraftMember[]
  currency: string
  onItems: (next: DraftItem[]) => void
}) {
  const elig = claimers(members)
  const patch = (key: string, change: Partial<DraftItem>) =>
    onItems(items.map((it) => (it.key === key ? { ...it, ...change } : it)))

  const contestedCount = items.filter((it) => {
    const n = it.claimants.filter((k) => elig.some((m) => m.key === k)).length || elig.length
    return n > it.qty
  }).length

  return (
    <Section
      step={3}
      title="Who’s claiming what"
      lede="A claim is what you are asking that person to pay for. Split a line between everyone, or let one person carry it alone — the arithmetic follows the claims, not the headcount."
      aside={contestedCount > 0 ? <Badge tone="warn">{contestedCount} contested</Badge> : undefined}
      collapsible
      defaultOpen={contestedCount > 0}
      summary="everyone shares each line"
    >
      {elig.length === 0 ? (
        <p className="small muted">
          Nobody can claim anything yet — sponsors and observers never claim. Give at least one person the payer or
          backstop role above.
        </p>
      ) : (
        <div className="col" style={{ gap: 10 }}>
          {items.map((it) => {
            const chosen = it.claimants.filter((k) => elig.some((m) => m.key === k))
            const effective = chosen.length > 0 ? chosen : elig.map((m) => m.key)
            const everyone = chosen.length === 0 || chosen.length === elig.length
            const contested = effective.length > it.qty
            const each = Math.floor(itemTotal(it) / Math.max(1, effective.length))

            return (
              <div key={it.key} className="well col" style={{ gap: 10 }}>
                <div className="row-between wrap" style={{ gap: 8 }}>
                  <div className="row" style={{ gap: 8, minWidth: 0 }}>
                    <span style={{ fontWeight: 550, fontSize: 14 }}>{it.name || 'Untitled line'}</span>
                    {it.tier === 'extra' && <Badge>extra</Badge>}
                  </div>
                  <span className="small muted">
                    <span className="mono">{it.qty}</span> × <span className="mono">{money(it.unitAmount, currency)}</span>
                  </span>
                </div>

                <Row gap={6}>
                  <ToggleChip
                    on={everyone}
                    onClick={() => patch(it.key, { claimants: elig.map((m) => m.key) })}
                    title="Everyone who can pay claims this line"
                  >
                    Everyone
                  </ToggleChip>
                  <span className="faint" aria-hidden>|</span>
                  {elig.map((m) => {
                    const on = effective.includes(m.key)
                    return (
                      <ToggleChip
                        key={m.key}
                        on={on}
                        onClick={() => {
                          const next = on ? effective.filter((k) => k !== m.key) : [...effective, m.key]
                          // An empty claim list would silently mean "everyone"
                          // again, so the last claimant cannot be switched off.
                          if (next.length === 0) return
                          patch(it.key, { claimants: next })
                        }}
                      >
                        {m.name || 'Unnamed'}
                      </ToggleChip>
                    )
                  })}
                </Row>

                {effective.length === 0 ? (
                  <p className="tiny" style={{ color: 'var(--warn)' }}>
                    Nobody is claiming this line. Either give it a claimant or remove it from the cart.
                  </p>
                ) : contested ? (
                  <div className="note" style={{ display: 'block' }}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>
                      Contested — {effective.length} people want {it.qty}{' '}
                      {it.qty === 1 ? 'unit' : 'units'}
                    </div>
                    <p className="tiny" style={{ lineHeight: 1.55 }}>
                      A sealed-bid window opens when the group starts. Everyone bids privately, the highest bids
                      take the {it.qty === 1 ? 'slot' : 'slots'}, and the losers simply drop off this line. Bids
                      allocate who gets it — they never change what it costs. The merchant is still paid{' '}
                      <span className="mono">{money(itemTotal(it), currency)}</span>.
                    </p>
                    <Row gap={6}>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ marginTop: 8 }}
                        onClick={() => patch(it.key, { qty: effective.length })}
                      >
                        One each instead — set quantity to {effective.length}
                      </button>
                    </Row>
                  </div>
                ) : (
                  <p className="tiny faint">
                    {effective.length === 1
                      ? `${elig.find((m) => m.key === effective[0])?.name ?? 'One person'} carries this line alone — ${money(itemTotal(it), currency)}.`
                      : `Split ${effective.length} ways — about ${money(each, currency)} each before fees.`}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Section>
  )
}
