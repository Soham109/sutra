'use client'

import type { Product } from '@/lib/api'
import { Badge, Money, Skeleton } from '@/components/ui'
import { ProductImage } from './product-image'

const SOURCE_LABEL: Record<Product['source'], string> = {
  url: 'From the link',
  shopify: 'Shopify',
  prava: 'Prava catalogue',
  starter: 'Starter set',
}

export function ProductCard({
  product,
  onPick,
  busy = false,
}: {
  product: Product
  onPick: (p: Product) => void
  busy?: boolean
}) {
  return (
    <div
      className="card"
      style={{
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        opacity: busy ? 0.6 : 1,
        ...(product.completes_on_card_rail ? { borderColor: 'var(--brand)' } : {}),
      }}
    >
      <ProductImage src={product.image_url} alt={product.title} domain={product.merchant.domain} />

      <div className="col grow" style={{ padding: 12, gap: 7 }}>
        {/* One meta line: where it came from, and whether it can actually be
            charged. The card-rail marker is a pill rather than a sentence —
            at this size a sentence wraps to three lines and the grid loses
            its rhythm. The full claim lives in the title attribute. */}
        <div className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <Badge>{SOURCE_LABEL[product.source] ?? product.source}</Badge>
          {product.completes_on_card_rail && (
            <span
              className="tiny"
              title="Charges a capped, merchant-locked Prava mandate per person. Nobody fronts anyone else."
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 7px',
                borderRadius: 999,
                fontWeight: 600,
                color: 'var(--brand)',
                background: 'color-mix(in srgb, var(--brand) 10%, transparent)',
                border: '1px solid color-mix(in srgb, var(--brand) 28%, transparent)',
                whiteSpace: 'nowrap',
              }}
            >
              ✓ Capped mandate each
            </span>
          )}
        </div>

        <div
          style={{
            fontWeight: 550,
            fontSize: 14,
            lineHeight: 1.35,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
          title={product.title}
        >
          {product.title}
        </div>

        <div className="tiny faint" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {product.subtitle ? `${product.subtitle} · ` : ''}
          {product.merchant.domain}
        </div>

        {/* Push price and actions to the bottom so every card in the row lines
            up regardless of how long its title ran. */}
        <div className="grow" />

        <div className="row" style={{ alignItems: 'baseline', gap: 6 }}>
          <Money minor={product.price.amount_minor} currency={product.price.currency} size="lg" />
          <span className="tiny faint">
            {product.unit_label}
            {product.in_stock ? '' : ' · out of stock'}
          </span>
        </div>

        <div className="row" style={{ gap: 8, marginTop: 3 }}>
          <button type="button" className="btn btn-primary grow" onClick={() => onPick(product)} disabled={busy}>
            {busy ? 'Reading page…' : 'Split this'}
          </button>
          <a
            className="btn btn-ghost"
            href={product.product_url}
            target="_blank"
            rel="noreferrer noopener"
            title={
              product.completes_on_card_rail
                ? "This store's own site asks visitors for a password — Sutra reads its real catalog via the store's Admin API instead"
                : "Open the merchant's page in a new tab"
            }
          >
            ↗
          </a>
        </div>
      </div>
    </div>
  )
}

export function ProductCardSkeleton() {
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div className="skeleton" style={{ aspectRatio: '4 / 3', borderRadius: 0 }} />
      <div className="col" style={{ padding: 12, gap: 9 }}>
        <Skeleton h={11} w="45%" />
        <Skeleton h={13} w="92%" />
        <Skeleton h={13} w="70%" />
        <Skeleton h={20} w="38%" />
        <Skeleton h={32} />
      </div>
    </div>
  )
}

export function ResultsGrid({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: 14,
      }}
    >
      {children}
    </div>
  )
}
