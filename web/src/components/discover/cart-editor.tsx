'use client'

import type { ProductDetail } from '@/lib/api'
import { Badge, Money } from '@/components/ui'
import { money } from '@/lib/format'
import { MoneyInput, QtyStepper, Row, Section, ToggleChip } from './fields'
import { type DraftFee, type DraftItem, itemTotal, uid } from './model'

export function CartEditor({
  product,
  variantId,
  onVariant,
  items,
  fees,
  currency,
  itemsTotal,
  feesTotal,
  onItems,
  onFees,
}: {
  product: ProductDetail
  variantId: string
  onVariant: (id: string) => void
  items: DraftItem[]
  fees: DraftFee[]
  currency: string
  itemsTotal: number
  feesTotal: number
  onItems: (next: DraftItem[]) => void
  onFees: (next: DraftFee[]) => void
}) {
  const patch = (key: string, change: Partial<DraftItem>) =>
    onItems(items.map((it) => (it.key === key ? { ...it, ...change } : it)))

  const hasExtras = items.some((it) => it.tier === 'extra')

  return (
    <Section
      step={1}
      title="The cart"
      lede="Everything the group is buying, line by line. Core lines are the reason the group exists; extras are dropped automatically if the people who wanted them leave."
      aside={
        <div className="col" style={{ alignItems: 'flex-end' }}>
          <Money minor={itemsTotal + feesTotal} currency={currency} size="lg" />
          <span className="tiny faint">cart total</span>
        </div>
      }
    >
      {product.variants.length > 1 && (
        <div className="well" style={{ marginBottom: 14 }}>
          <span className="field-label">Which one?</span>
          <Row gap={6}>
            {product.variants.map((v) => (
              <ToggleChip
                key={v.id}
                on={v.id === variantId}
                onClick={() => onVariant(v.id)}
                title={v.available ? undefined : 'The merchant lists this as unavailable'}
              >
                {v.name}
                <span className="mono">{money(v.price.amount_minor, v.price.currency)}</span>
                {!v.available && <span className="faint">· sold out</span>}
              </ToggleChip>
            ))}
          </Row>
          <p className="tiny faint" style={{ marginTop: 8 }}>
            Changing the variant rewrites the first line of the cart — the sku is what the merchant will actually
            be charged for.
          </p>
        </div>
      )}

      <div className="col" style={{ gap: 10 }}>
        {items.map((it, i) => (
          <div key={it.key} className="well col" style={{ gap: 10 }}>
            <div className="row wrap" style={{ gap: 10 }}>
              <input
                className="input grow"
                style={{ minWidth: 160 }}
                aria-label="Line name"
                value={it.name}
                placeholder="What is this line?"
                onChange={(e) => patch(it.key, { name: e.target.value })}
              />
              <QtyStepper value={it.qty} onChange={(qty) => patch(it.key, { qty })} />
              <MoneyInput
                value={it.unitAmount}
                currency={currency}
                width={110}
                ariaLabel="Unit price"
                onChange={(unitAmount) => patch(it.key, { unitAmount })}
              />
            </div>

            <div className="row-between wrap" style={{ gap: 10 }}>
              <Row gap={6}>
                <ToggleChip on={it.tier === 'core'} onClick={() => patch(it.key, { tier: 'core' })}>
                  Core
                </ToggleChip>
                <ToggleChip on={it.tier === 'extra'} onClick={() => patch(it.key, { tier: 'extra' })}>
                  Extra
                </ToggleChip>
                <span className="mono tiny faint" title="Sent to the merchant as the sku">
                  {it.sku || 'no sku'}
                </span>
              </Row>

              <Row gap={10}>
                <span className="small muted">
                  {it.qty} × {money(it.unitAmount, currency)} ={' '}
                  <span className="amount">{money(itemTotal(it), currency)}</span>
                </span>
                {items.length > 1 && (
                  <button
                    type="button"
                    className="btn btn-ghost tiny"
                    onClick={() => onItems(items.filter((x) => x.key !== it.key))}
                    aria-label={`Remove line ${i + 1}`}
                  >
                    Remove
                  </button>
                )}
              </Row>
            </div>
          </div>
        ))}
      </div>

      {hasExtras && (
        <p className="tiny faint" style={{ marginTop: 10 }}>
          An <b style={{ fontWeight: 550 }}>extra</b> is bought only if the people claiming it stay in. If they all
          drop out, the line is removed and the group commits without it — a core line dropping out ends the group
          instead.
        </p>
      )}

      <Row gap={8}>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ marginTop: 12 }}
          onClick={() =>
            onItems([
              ...items,
              {
                key: uid('i'),
                sku: '',
                name: '',
                unitAmount: 0,
                qty: 1,
                tier: 'extra',
                claimants: items[0]?.claimants ?? [],
              },
            ])
          }
        >
          + Add a line
        </button>
      </Row>

      <hr className="divider" style={{ margin: '16px 0 14px' }} />

      <div className="row-between wrap" style={{ gap: 10, marginBottom: 10 }}>
        <div>
          <h3 style={{ fontSize: 14 }}>Fees</h3>
          <p className="tiny faint">Shipping, tax, anything the merchant adds at checkout. Split pro-rata on what
            each person claimed, so someone claiming more of the cart carries more of the shipping.</p>
        </div>
        <Money minor={feesTotal} currency={currency} />
      </div>

      <div className="col" style={{ gap: 8 }}>
        {fees.map((f) => (
          <div key={f.key} className="row wrap" style={{ gap: 8 }}>
            <input
              className="input grow"
              style={{ minWidth: 140 }}
              aria-label="Fee name"
              value={f.name}
              placeholder="Shipping"
              onChange={(e) => onFees(fees.map((x) => (x.key === f.key ? { ...x, name: e.target.value } : x)))}
            />
            <MoneyInput
              value={f.amount}
              currency={currency}
              width={110}
              ariaLabel="Fee amount"
              onChange={(amount) => onFees(fees.map((x) => (x.key === f.key ? { ...x, amount } : x)))}
            />
            <button type="button" className="btn btn-ghost" onClick={() => onFees(fees.filter((x) => x.key !== f.key))}>
              Remove
            </button>
          </div>
        ))}
      </div>

      <Row gap={8}>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ marginTop: fees.length ? 10 : 0 }}
          onClick={() => onFees([...fees, { key: uid('f'), name: 'Shipping', amount: 0 }])}
        >
          + Shipping
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ marginTop: fees.length ? 10 : 0 }}
          onClick={() => onFees([...fees, { key: uid('f'), name: 'Tax', amount: 0 }])}
        >
          + Tax
        </button>
        {fees.length === 0 && (
          <span className="tiny faint" style={{ alignSelf: 'center' }}>
            <Badge>optional</Badge>
          </span>
        )}
      </Row>
    </Section>
  )
}
