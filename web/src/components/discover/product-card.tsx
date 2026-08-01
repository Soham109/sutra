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
      style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column', opacity: busy ? 0.6 : 1 }}
    >
      <ProductImage src={product.image_url} alt={product.title} domain={product.merchant.domain} />

      <div className="col grow" style={{ padding: 12, gap: 8 }}>
        <div className="row-between" style={{ gap: 8, alignItems: 'flex-start' }}>
          <span className="mono tiny faint" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {product.merchant.domain}
          </span>
          <Badge>{SOURCE_LABEL[product.source] ?? product.source}</Badge>
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

        {product.subtitle && (
          <div className="tiny faint" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {product.subtitle}
          </div>
        )}

        <div className="row-between grow" style={{ alignItems: 'flex-end', marginTop: 2 }}>
          <div className="col" style={{ gap: 2 }}>
            <Money minor={product.price.amount_minor} currency={product.price.currency} size="lg" />
            <span className="tiny faint">
              {product.unit_label}
              {product.in_stock ? '' : ' · out of stock'}
            </span>
          </div>
        </div>

        <div className="row" style={{ gap: 8, marginTop: 2 }}>
          <button type="button" className="btn btn-primary grow" onClick={() => onPick(product)} disabled={busy}>
            {busy ? 'Reading page…' : 'Split this'}
          </button>
          <a
            className="btn btn-ghost"
            href={product.product_url}
            target="_blank"
            rel="noreferrer noopener"
            title="Open the merchant's page in a new tab"
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
