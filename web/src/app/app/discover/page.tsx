import { Suspense } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Shell } from '@/components/shell'
import { DiscoverClient, DiscoverSkeleton } from '@/components/discover/discover-client'

export const metadata: Metadata = {
  title: 'Discover — sutra',
  description: 'Search a few catalogues, or paste a product link from any store, then split it with a group.',
}

export default function DiscoverPage() {
  return (
    <Shell
      crumbs={
        <>
          <Link href="/app" className="muted">
            Home
          </Link>
          <span className="sep" aria-hidden>
            /
          </span>
          <span className="here">Discover</span>
        </>
      }
    >
      {/* useSearchParams needs a boundary, and the boundary is also the
          honest place to show the page's own loading state. */}
      <Suspense fallback={<DiscoverSkeleton />}>
        <DiscoverClient />
      </Suspense>
    </Shell>
  )
}
