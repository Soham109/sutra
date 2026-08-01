'use client'

import { useState } from 'react'
import { Badge, Countdown, Money } from '@/components/ui'
import { clockTime, toMinor } from '@/lib/format'
import type { ContestedItem } from './model'

/**
 * §21.1 — sealed priority bids. The one thing people get wrong about auctions
 * in a group buy is thinking the bid is the price, so that sentence is printed
 * on the card and not in a tooltip.
 */
export function AuctionPanel({
  auction,
  currency,
  onBid,
  busy,
  lost,
}: {
  auction: { open: boolean; closes_at: string; contested_items: ContestedItem[] }
  currency: string
  onBid: (sku: string, amount: number) => void
  busy: boolean
  lost: boolean
}) {
  const items = auction.contested_items
  if (items.length === 0) return null

  if (!auction.open) {
    return (
      <section className="card card-pad col" style={{ gap: 8 }}>
        <div className="row-between">
          <span className="eyebrow">Contested items</span>
          <Badge>closed</Badge>
        </div>
        <p className="small muted">
          Bidding closed at {clockTime(auction.closes_at)} and every bid was revealed at once.
          {lost
            ? ' You did not get a slot, so your share was requoted — you only ever pay for what you actually get.'
            : ' Slots were allocated by priority; the price never moved.'}
        </p>
      </section>
    )
  }

  return (
    <section className="card card-pad col" style={{ gap: 14 }}>
      <div className="row-between">
        <span className="eyebrow">Contested items</span>
        <span className="row" style={{ gap: 8 }}>
          <Badge tone="brand">sealed</Badge>
          <Countdown to={auction.closes_at} />
        </span>
      </div>

      <p className="small muted" style={{ marginTop: -4 }}>
        More of you want these than there are slots. Name how much you want it — a <b>sealed priority bid</b>.
        Bids decide <b>who gets a slot</b>, never what anything costs. Nobody sees anybody&apos;s bid until they
        are all revealed together at {clockTime(auction.closes_at)}.
      </p>

      {items.map((item) => (
        <BidRow key={item.sku} item={item} currency={currency} onBid={onBid} busy={busy} />
      ))}
    </section>
  )
}

function BidRow({
  item,
  currency,
  onBid,
  busy,
}: {
  item: ContestedItem
  currency: string
  onBid: (sku: string, amount: number) => void
  busy: boolean
}) {
  const div = toMinor('1', currency) || 100
  const [value, setValue] = useState(item.my_bid == null ? '' : (item.my_bid / div).toFixed(div === 1 ? 0 : 2))

  return (
    <div className="well col" style={{ gap: 10 }}>
      <div className="row-between" style={{ alignItems: 'flex-start' }}>
        <div className="grow">
          <div style={{ fontWeight: 550 }}>{item.name}</div>
          <div className="tiny faint">
            {item.claimants} people want {item.slots} slot{item.slots === 1 ? '' : 's'}
          </div>
        </div>
        {item.my_bid != null && (
          <div className="col" style={{ alignItems: 'flex-end' }}>
            <span className="tiny faint">your bid</span>
            <Money minor={item.my_bid} currency={currency} />
          </div>
        )}
      </div>

      <div className="ap-bidrow">
        <input
          className="input"
          inputMode="decimal"
          placeholder={`priority in ${currency}`}
          aria-label={`Sealed priority bid for ${item.name}`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button
          className="btn btn-secondary"
          disabled={busy || value.trim() === ''}
          onClick={() => onBid(item.sku, toMinor(value, currency))}
        >
          {item.my_bid == null ? 'Seal bid' : 'Revise'}
        </button>
      </div>

      <p className="tiny faint">
        Winning never changes what it costs. If you get the slot you pay the merchant&apos;s price, exactly as
        quoted, inside the cap you already agreed to. If you don&apos;t, your share is requoted downward.
      </p>
    </div>
  )
}
