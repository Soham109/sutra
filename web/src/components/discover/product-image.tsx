'use client'

import { useEffect, useState } from 'react'

// Product images come from whatever domain the merchant happens to use, so a
// plain <img> is the honest tool: no proxy, no optimiser, and a fallback that
// is drawn in CSS rather than fetched — a broken image never becomes a hole.

export function ProductImage({
  src,
  alt,
  domain,
  ratio = '4 / 3',
  radius = 'var(--r) var(--r) 0 0',
}: {
  src?: string
  alt: string
  domain: string
  ratio?: string
  radius?: string
}) {
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
  }, [src])

  const frame: React.CSSProperties = {
    aspectRatio: ratio,
    width: '100%',
    overflow: 'hidden',
    borderRadius: radius,
    background: 'var(--surface-2)',
    borderBottom: '1px solid var(--line)',
  }

  if (!src || failed) {
    return (
      <div
        style={{
          ...frame,
          display: 'grid',
          placeItems: 'center',
          backgroundImage:
            'repeating-linear-gradient(135deg, var(--surface-2) 0 10px, var(--surface-3) 10px 20px)',
        }}
        role="img"
        aria-label={`No image for ${alt}`}
      >
        <span
          className="mono tiny"
          style={{
            color: 'var(--ink-3)',
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--r-sm)',
            padding: '3px 8px',
            maxWidth: '85%',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {domain || 'no image'}
        </span>
      </div>
    )
  }

  return (
    <div style={frame}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
    </div>
  )
}
