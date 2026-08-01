'use client'

import { useState } from 'react'
import { api } from '@/lib/api'
import { Badge, Empty, Money, Skeleton } from '@/components/ui'

// "Find me the cheapest one."
//
// The number is the easy part. The part that decides whether this is useful or
// actively harmful is whether two listings are the same thing — a 250g bag
// ranked against a 1kg one is not a saving, it is a wrong answer that a group
// is about to split money on. So this panel prints, every time and without
// being asked: what it compared, on what basis, how sure it is, and what it
// could not group at all.

export interface CompareOffer {
  product: {
    id: string
    title: string
    price: { amount_minor: number; currency: string }
    merchant: { name: string; domain: string }
    product_url: string
    in_stock: boolean
    image_url?: string
  }
  unit_price_minor: number | null
  size: { base: number; dimension: 'mass' | 'volume' | 'count'; label: string } | null
  premium_minor: number | null
}

export interface CompareGroup {
  title: string
  offers: CompareOffer[]
  currency: string
  best: CompareOffer
  basis: 'unit' | 'sticker'
  confidence: 'exact' | 'likely' | 'loose'
  spread_minor: number
  caveats: string[]
}

interface CompareResponse {
  groups: CompareGroup[]
  ungrouped: { id: string; title: string }[]
  currencies: string[]
  searched: number
  took_ms: number
}

const CONFIDENCE_LABEL: Record<CompareGroup['confidence'], string> = {
  exact: 'Same item',
  likely: 'Probably the same',
  loose: 'Only similar',
}

const CONFIDENCE_TONE: Record<CompareGroup['confidence'], 'ok' | 'warn' | 'plain'> = {
  exact: 'ok',
  likely: 'plain',
  loose: 'warn',
}

export function PriceCompare({
  query,
  onPick,
}: {
  query: string
  onPick?: (url: string) => void
}) {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [data, setData] = useState<CompareResponse | null>(null)
  const [error, setError] = useState('')

  const run = async () => {
    setState('loading')
    setError('')
    try {
      const res = await api.get<CompareResponse>(
        `/v1/discover/compare?q=${encodeURIComponent(query)}&limit=40`,
      )
      setData(res)
      setState('done')
    } catch (e) {
      setError((e as Error).message || 'The comparison did not come back.')
      setState('error')
    }
  }

  if (state === 'idle') {
    return (
      <div className="card card-pad compare-invite">
        <div className="col" style={{ gap: 4 }}>
          <strong style={{ fontSize: 14 }}>Check whether anywhere sells this cheaper</strong>
          <span className="small muted">
            Searches every store on the shelf, groups the listings that are genuinely the same
            item, and ranks them per gram or per item where a size is printed — not by the number
            on the label.
          </span>
        </div>
        <button className="btn btn-primary" onClick={() => void run()}>
          Compare prices
        </button>
      </div>
    )
  }

  if (state === 'loading') {
    return (
      <div className="col" style={{ gap: 10 }}>
        <Skeleton h={92} />
        <Skeleton h={92} />
      </div>
    )
  }

  if (state === 'error') {
    return (
      <Empty
        title="The comparison did not come back"
        action={
          <button className="btn" onClick={() => void run()}>
            Try again
          </button>
        }
      >
        {error} Every store is searched live, so this is usually momentary.
      </Empty>
    )
  }

  if (!data) return null

  if (data.groups.length === 0) {
    return (
      <Empty title="Nothing here is the same thing twice">
        {data.searched} listing{data.searched === 1 ? '' : 's'} came back, but no two of them
        matched closely enough to call one cheaper than the other.
        {data.currencies.length > 1 && (
          <> They are also priced in {data.currencies.join(' and ')}, which are never ranked
          against each other.</>
        )}{' '}
        Paste the link to the exact item instead and Sutra will read that page directly.
      </Empty>
    )
  }

  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row-between wrap" style={{ gap: 8 }}>
        <h3 style={{ fontSize: 15 }}>
          {data.groups.length} thing{data.groups.length === 1 ? '' : 's'} sold in more than one
          place
        </h3>
        <span className="tiny faint mono">
          {data.searched} listings · {data.took_ms}ms
        </span>
      </div>

      {data.currencies.length > 1 && (
        <p className="tiny faint">
          Prices came back in {data.currencies.join(', ')}. Offers are only ever ranked against
          others in the same currency — converting them here would invent a saving that depends on
          today’s rate.
        </p>
      )}

      {data.groups.map((g, i) => (
        <GroupCard key={i} group={g} onPick={onPick} />
      ))}
    </div>
  )
}

function GroupCard({ group, onPick }: { group: CompareGroup; onPick?: (url: string) => void }) {
  const [open, setOpen] = useState(false)
  const shown = open ? group.offers : group.offers.slice(0, 3)
  const saving = group.spread_minor

  return (
    <div className="card card-pad col compare-group" style={{ gap: 10 }}>
      <div className="row-between wrap" style={{ gap: 8 }}>
        <div className="col" style={{ gap: 3, minWidth: 0 }}>
          <strong className="compare-title">{group.title}</strong>
          <div className="row" style={{ gap: 6 }}>
            <Badge tone={CONFIDENCE_TONE[group.confidence]}>
              {CONFIDENCE_LABEL[group.confidence]}
            </Badge>
            <span className="tiny faint">
              {group.offers.length} places · ranked{' '}
              {group.basis === 'unit' ? 'per unit' : 'on the price shown'}
            </span>
          </div>
        </div>
        {saving > 0 && (
          <div className="compare-saving">
            <span className="tiny faint">Cheapest saves</span>
            <strong>
              <Money minor={saving} currency={group.currency} />
            </strong>
          </div>
        )}
      </div>

      <ol className="compare-list">
        {shown.map((o, i) => (
          <li key={o.product.id} className={i === 0 ? 'is-best' : undefined}>
            <div className="col" style={{ gap: 2, minWidth: 0 }}>
              <a
                href={o.product.product_url}
                target="_blank"
                rel="noreferrer noopener"
                className="compare-offer-title"
              >
                {o.product.title}
              </a>
              <span className="tiny faint">
                {o.product.merchant.domain}
                {o.size && ` · ${o.size.label}`}
                {!o.product.in_stock && ' · out of stock'}
              </span>
            </div>
            <div className="compare-price">
              <strong>
                <Money minor={o.product.price.amount_minor} currency={group.currency} />
              </strong>
              {i > 0 && o.premium_minor ? (
                <span className="tiny faint">
                  +<Money minor={o.premium_minor} currency={group.currency} />
                </span>
              ) : i === 0 ? (
                <span className="tiny" style={{ color: 'var(--ok)' }}>
                  cheapest
                </span>
              ) : null}
            </div>
            {onPick && (
              <button className="btn btn-ghost tiny" onClick={() => onPick(o.product.product_url)}>
                Split this
              </button>
            )}
          </li>
        ))}
      </ol>

      {group.offers.length > 3 && (
        <button className="composer-mode" onClick={() => setOpen((v) => !v)}>
          {open ? 'Show fewer' : `Show all ${group.offers.length}`}
        </button>
      )}

      {/* Always printed, never behind a disclosure. A saving whose caveats are
          hidden is worse than no saving at all. */}
      {group.caveats.length > 0 && (
        <ul className="compare-caveats">
          {group.caveats.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
