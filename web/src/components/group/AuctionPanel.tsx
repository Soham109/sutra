'use client'

import { Avatar, Badge, Countdown } from '@/components/ui'
import { money } from '@/lib/format'
import type { AuctionItemView, AuctionRevealView } from './derive'

// Sealed bids decide who gets a contested item. They never decide what anyone
// pays — saying that out loud is the difference between an auction and a scam.

export function AuctionPanel({
  closesAt,
  open,
  items,
  reveals,
  bids,
  currency,
}: {
  closesAt: string | null
  open: boolean
  items: AuctionItemView[]
  reveals: AuctionRevealView[]
  bids: Record<string, string[]>
  currency: string
}) {
  const revealed = new Set(reveals.map((r) => r.sku))

  return (
    <div className="card">
      <div className="gr-sec">
        <h3>Sealed bids</h3>
        {open ? (
          <span className="row" style={{ gap: 7 }}>
            <span className="dot dot-brand dot-live" />
            {closesAt ? <Countdown to={closesAt} /> : <span className="tiny mono muted">open</span>}
          </span>
        ) : (
          <Badge tone="plain">Closed</Badge>
        )}
      </div>

      <div style={{ padding: 16 }} className="stack">
        {open && (
          <div className="gr-seal">
            <div className="eyebrow" style={{ marginBottom: 6 }}>
              Bidding window
            </div>
            <p className="small muted" style={{ maxWidth: '44ch' }}>
              Bids are sealed. Nobody — including the organiser — sees an amount until the window closes.
            </p>
          </div>
        )}

        {items.length > 0 && (
          <div>
            {items.map((it) => (
              <div className="gr-line" key={it.sku}>
                <span style={{ minWidth: 0 }}>
                  {it.name} <code className="tiny faint mono">{it.sku}</code>
                </span>
                <span className="tiny mono muted">
                  {it.slots} {it.slots === 1 ? 'slot' : 'slots'} · {(bids[it.sku] ?? []).length || it.claimants} bidding
                  {revealed.has(it.sku) ? ' · revealed' : ''}
                </span>
              </div>
            ))}
          </div>
        )}

        {reveals.map((r) => (
          <div className="well" key={r.sku}>
            <div className="row-between" style={{ marginBottom: 6 }}>
              <span style={{ fontWeight: 550 }}>{r.item}</span>
              <span className="tiny mono faint">
                {r.slots} {r.slots === 1 ? 'slot' : 'slots'}
              </span>
            </div>
            {r.ranking.map((b, i) => (
              <div className="gr-rank" key={`${r.sku}-${b.name}-${i}`}>
                <span className="tiny mono faint" style={{ width: 18 }}>
                  {i + 1}
                </span>
                <Avatar name={b.name} size="sm" />
                <span className="grow small" style={{ minWidth: 0 }}>
                  {b.name}
                </span>
                <span className="amount" style={{ fontSize: 13 }}>
                  {money(b.amount, currency)}
                </span>
                <Badge tone={b.won ? 'ok' : 'plain'}>{b.won ? 'Won' : 'Lost'}</Badge>
              </div>
            ))}
          </div>
        ))}

        <p className="note note-plain">
          Bids allocate the contested slots. They never change the price anyone pays — the losing bidders simply drop
          the item and their share is re-quoted downward.
        </p>
      </div>
    </div>
  )
}
