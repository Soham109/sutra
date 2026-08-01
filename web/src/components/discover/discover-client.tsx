'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { api, type Product, type ProductDetail, type SearchResponse } from '@/lib/api'
import { Badge, Empty, ErrorNote, Money, Skeleton } from '@/components/ui'
import { Builder } from './builder'
import { HowThisWorksNote } from './empty-state'
import { ProductCard, ProductCardSkeleton, ResultsGrid } from './product-card'
import { ProductImage } from './product-image'
import { PriceCompare } from './price-compare'
import { SourceErrors, SourceStrip, UnavailableSources, type SourceHealth } from './sources'
import { detailFromProduct, domainOf, looksLikeUrl, normaliseUrl } from './model'

interface Resolved {
  product: ProductDetail
  strategy: string
  warnings: string[]
  /** True when we could not read the page and started from the search hit. */
  partial?: boolean
}

const TLD_COUNTRY: Record<string, string> = {
  uk: 'GB', in: 'IN', de: 'DE', fr: 'FR', ca: 'CA', au: 'AU', jp: 'JP', sg: 'SG', ae: 'AE', nl: 'NL', es: 'ES', it: 'IT',
}

/** Last resort: a blank line at whatever store the link pointed at, so an
 *  unreadable page is a detour rather than a wall. */
function blankDetail(raw: string): ProductDetail {
  const url = normaliseUrl(raw)
  let host = domainOf(raw)
  let origin = url
  try {
    const u = new URL(url)
    host = u.hostname.replace(/^www\./, '')
    origin = u.origin
  } catch {
    /* keep the string-derived fallbacks */
  }
  const tld = host.split('.').pop() ?? ''
  return {
    id: 'manual',
    title: '',
    price: { amount_minor: 0, currency: 'USD' },
    unit_label: 'each',
    merchant: { name: host, url: origin, country_code_iso2: TLD_COUNTRY[tld] ?? 'US', domain: host },
    product_url: url,
    in_stock: true,
    source: 'url',
    variants: [],
    images: [],
    fine_print: [],
  }
}

/** A split with nothing to read from any page — a restaurant bill, a shared
 *  cab, anything without a product URL. No merchant, no link, just a name and
 *  a total the organizer types in themselves. */
function manualDetail(label: string): ProductDetail {
  return {
    id: 'manual',
    title: '',
    price: { amount_minor: 0, currency: 'USD' },
    unit_label: 'each',
    merchant: { name: label, url: '', country_code_iso2: 'US', domain: '' },
    product_url: '',
    in_stock: true,
    source: 'url',
    variants: [],
    images: [],
    fine_print: [],
  }
}

type Moment =
  | { icon: string; label: string; kind: 'paste'; placeholder: string; hint: string }
  | { icon: string; label: string; kind: 'manual'; hint: string }

/**
 * Every one of these used to run a literal-text search for its own label —
 * "Movie tickets" searched for the string "Movie tickets" against a catalog
 * of three activewear stores, and returned nothing. Search only reaches a
 * handful of demo storefronts; pasting a link reads almost any single
 * product page directly. So each of these now routes to whichever of those
 * two things actually works for that kind of purchase, instead of pretending
 * search covers categories it does not.
 */
const MOMENTS: Moment[] = [
  {
    icon: '◒', label: 'Movie tickets', kind: 'paste',
    placeholder: 'Paste the tickets page — your BookMyShow or Fandango link',
    hint: 'Sutra reads the showtime, seats and price straight off that page.',
  },
  {
    icon: '✦', label: 'Flights', kind: 'paste',
    placeholder: 'Paste the fare page from the airline or booking site',
    hint: 'Paste the exact fare everyone would book, not a screenshot of it.',
  },
  {
    icon: '⌂', label: 'A place to stay', kind: 'paste',
    placeholder: 'Paste the listing — Airbnb, Booking.com, the hotel’s own page',
    hint: 'One link, and the nightly rate splits however the group decides.',
  },
  {
    icon: '♫', label: 'Concert tickets', kind: 'paste',
    placeholder: 'Paste the tickets page for the show',
    hint: 'Same idea as movie tickets — the exact listing, not a search page.',
  },
  {
    icon: '⌁', label: 'Dinner', kind: 'manual',
    hint: 'A shared bill has no page to read — type the total and split it.',
  },
  {
    icon: '◇', label: 'Group gift', kind: 'paste',
    placeholder: 'Paste the product page for the gift',
    hint: 'Works like any other item — paste the page, set who is chipping in.',
  },
]

/** Queries that are known to return real products from the default shelf.
 *  Verified against the live engine rather than hopefully typed in. */
const EXAMPLES = [
  { label: 'merino tee', q: 'merino tee', store: '' },
  { label: 'earbuds', q: 'earbuds', store: 'boat-lifestyle.com' },
  { label: 'trimmer', q: 'trimmer', store: 'bombayshavingcompany.com' },
  { label: 'gym shorts', q: 'shorts', store: 'gymshark.com' },
]

/** "amazon.com", "www.zara.in" — a shop, with no path to a specific item. */
function isBareStore(q: string): boolean {
  const s = q.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '')
  return /^[\w-]+(\.[\w-]+)+$/.test(s)
}

export function DiscoverClient() {
  const router = useRouter()
  const params = useSearchParams()

  const [q, setQ] = useState('')
  const [store, setStore] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'done'>('idle')
  const [results, setResults] = useState<SearchResponse | null>(null)
  const [resolved, setResolved] = useState<Resolved | null>(null)
  const [hint, setHint] = useState<{ placeholder: string; text: string } | null>(null)
  const [error, setError] = useState('')
  const [errorUrl, setErrorUrl] = useState('')
  const [picking, setPicking] = useState('')
  const [mode, setMode] = useState<'search' | 'build'>('search')
  const [health, setHealth] = useState<SourceHealth[]>([])

  const seq = useRef(0)
  const started = useRef(false)
  const searchInput = useRef<HTMLInputElement>(null)
  const storeInput = useRef<HTMLInputElement>(null)

  const runSearch = useCallback(async (query: string, merchant: string) => {
    const text = query.trim()
    if (!text) return
    const mine = ++seq.current
    setMode('search')
    setStatus('loading')
    setError('')
    setErrorUrl('')
    setResolved(null)
    setResults(null)
    try {
      const qs = new URLSearchParams({ q: text, limit: '12' })
      const domain = domainOf(merchant)
      if (domain) qs.set('merchant', domain)
      const res = await api.get<SearchResponse>(`/v1/discover/search?${qs.toString()}`)
      if (mine !== seq.current) return
      setResults(res)
      setStatus('done')
    } catch (e) {
      if (mine !== seq.current) return
      setError(
        `${(e as Error).message || 'The search did not come back.'} The catalogues are searched live, so this is usually momentary — try again, or paste a link to the exact item instead.`,
      )
      setStatus('done')
    }
  }, [])

  const resolveUrl = useCallback(async (raw: string, autoBuild: boolean) => {
    const url = normaliseUrl(raw)
    const mine = ++seq.current
    setMode('search')
    setStatus('loading')
    setError('')
    setErrorUrl('')
    setResults(null)
    setResolved(null)
    try {
      const res = await api.post<{ product: ProductDetail; strategy: string; warnings: string[] }>(
        '/v1/discover/resolve',
        { url },
      )
      if (mine !== seq.current) return
      setResolved({ product: res.product, strategy: res.strategy, warnings: res.warnings ?? [] })
      setStatus('done')
      if (autoBuild) setMode('build')
    } catch (e) {
      if (mine !== seq.current) return
      setError((e as Error).message || 'That page could not be read.')
      setErrorUrl(url)
      setStatus('done')
    }
  }, [])

  // One shot on mount: ?url= resolves immediately, ?q= searches, ?step=build
  // walks straight back into the builder so a refresh never loses the thread.
  useEffect(() => {
    if (started.current) return
    started.current = true
    const url = params.get('url')
    const query = params.get('q') ?? ''
    const merchant = params.get('merchant') ?? ''
    if (merchant) setStore(merchant)
    if (url) {
      setQ(url)
      void resolveUrl(url, params.get('step') === 'build')
    } else if (query) {
      setQ(query)
      void runSearch(query, merchant)
    }
  }, [params, resolveUrl, runSearch])

  useEffect(() => {
    let live = true
    api
      .get<{ sources: SourceHealth[] }>('/v1/discover/sources')
      .then((res) => {
        if (live) setHealth(res.sources ?? [])
      })
      .catch(() => {
        /* the strip under the results already reports what answered */
      })
    return () => {
      live = false
    }
  }, [])

  const isUrl = looksLikeUrl(q)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setHint(null)
    const text = q.trim()
    if (!text) return
    if (looksLikeUrl(text)) {
      router.replace(`/app/discover?url=${encodeURIComponent(normaliseUrl(text))}`, { scroll: false })
      void resolveUrl(text, false)
    } else {
      const domain = domainOf(store)
      router.replace(
        `/app/discover?q=${encodeURIComponent(text)}${domain ? `&merchant=${encodeURIComponent(domain)}` : ''}`,
        { scroll: false },
      )
      void runSearch(text, store)
    }
  }

  /** Nothing to read from any page — skip straight to a blank, editable draft. */
  const startManual = (label: string) => {
    setHint(null)
    setResolved({
      product: manualDetail(label),
      strategy: 'entered by hand',
      warnings: [`There is no page to read for “${label}” — the name, the total and who owes what are all yours to set.`],
      partial: true,
    })
    setMode('build')
    router.replace('/app/discover?step=build', { scroll: false })
  }

  const pickMoment = (m: Moment) => {
    if (m.kind === 'manual') {
      startManual(m.label)
      return
    }
    setQ('')
    setHint({ placeholder: m.placeholder, text: m.hint })
    searchInput.current?.focus()
  }

  /** A search hit only carries the summary — read the real page before building. */
  const pick = async (p: Product) => {
    setPicking(p.id)
    try {
      const res = await api.post<{ product: ProductDetail; strategy: string; warnings: string[] }>(
        '/v1/discover/resolve',
        { url: p.product_url },
      )
      setResolved({ product: res.product, strategy: res.strategy, warnings: res.warnings ?? [] })
    } catch {
      setResolved({
        product: detailFromProduct(p),
        strategy: 'search result',
        warnings: [
          'The merchant’s page would not load just now, so this is built from the search result. Check the price and the variant before you send it to anybody.',
        ],
        partial: true,
      })
    } finally {
      setPicking('')
    }
    setMode('build')
    router.replace(`/app/discover?url=${encodeURIComponent(p.product_url)}&step=build`, { scroll: false })
  }

  const startBuild = () => {
    if (!resolved) return
    setMode('build')
    router.replace(`/app/discover?url=${encodeURIComponent(resolved.product.product_url)}&step=build`, {
      scroll: false,
    })
  }

  const backToSearch = () => {
    setMode('search')
    const text = q.trim()
    router.replace(
      text && !looksLikeUrl(text) ? `/app/discover?q=${encodeURIComponent(text)}` : '/app/discover',
      { scroll: false },
    )
  }

  if (mode === 'build' && resolved) {
    return (
      <div className="page">
        <Builder
          product={resolved.product}
          strategy={resolved.partial ? undefined : resolved.strategy}
          warnings={resolved.warnings}
          onBack={backToSearch}
        />
      </div>
    )
  }

  const loading = status === 'loading'

  return (
    <div className="page discover-page">
      <div className="page-head discover-head">
        <span className="eyebrow">New split</span>
        <h1>Find it.<br /><span>Then split it.</span></h1>
        <p className="muted">
          Search the stores below, or paste a link from anywhere — sutra reads the merchant’s own
          price and options off the page. Then decide who’s paying for what.
        </p>
      </div>

      <form onSubmit={submit} className="card card-pad discover-search" style={{ marginBottom: 14 }}>
        <div className="row wrap" style={{ gap: 10 }}>
          <div className="grow" style={{ minWidth: 200 }}>
            <input
              ref={searchInput}
              className="input input-lg"
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                if (hint) setHint(null)
              }}
              placeholder={hint?.placeholder ?? 'Search “merino tee”, or paste any product link'}
              aria-label="Search for a product, or paste a product link"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <button type="submit" className="btn btn-primary btn-lg" disabled={!q.trim() || loading}>
            {loading ? 'Working…' : isUrl ? 'Read this link' : 'Search'}
          </button>
        </div>

        <div className="row-between wrap" style={{ gap: 10, marginTop: 10 }}>
          <p className="tiny faint" style={{ maxWidth: '60ch', lineHeight: 1.6 }}>
            {hint ? (
              hint.text
            ) : isUrl ? (
              <>
                That looks like a link — sutra will open the page and read the merchant’s own product data: price,
                currency, variants, stock.
              </>
            ) : (
              <>
                Searching eight storefronts. Anywhere else, paste the link to the exact item — that
                works on nearly every store, including the ones that never appear here.
              </>
            )}
          </p>
          <label className="row" style={{ gap: 8 }}>
            <span className="tiny faint" style={{ whiteSpace: 'nowrap' }}>
              only this store
            </span>
            <input
              ref={storeInput}
              className="input mono"
              style={{ width: 170, fontSize: 13 }}
              value={store}
              onChange={(e) => setStore(e.target.value)}
              placeholder="allbirds.com"
              aria-label="Limit the search to one store"
              disabled={isUrl}
            />
          </label>
        </div>

        {/* Something to press. A search box with no examples makes people guess
            what the catalogue contains, guess wrong, get nothing, and conclude
            the product is broken. Each of these returns real results. */}
        {!isUrl && !results && (
          <div className="discover-examples">
            <span className="tiny faint">Try:</span>
            {EXAMPLES.map((ex) => (
              <button
                key={ex.q + ex.store}
                type="button"
                onClick={() => {
                  setQ(ex.q)
                  setStore(ex.store)
                  void runSearch(ex.q, ex.store)
                }}
              >
                {ex.label}
              </button>
            ))}
          </div>
        )}

        {isUrl && store.trim() !== '' && (
          <p className="tiny faint" style={{ marginTop: 6 }}>
            The store filter is ignored for links — the link already says which store.
          </p>
        )}
      </form>

      {!loading && !results && !resolved && (
        <div className="discover-moments" aria-label="Common ways to start">
          <p className="tiny faint discover-moments-label">Or start from what you’re actually splitting</p>
          <div className="discover-moments-grid">
            {MOMENTS.map((m) => (
              <button key={m.label} type="button" onClick={() => pickMoment(m)}>
                <span>{m.icon}</span>{m.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div style={{ marginBottom: 18 }}>
          <ErrorNote>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span>{error}</span>
              {errorUrl && (
                <>
                  <span className="tiny">
                    Paste the page for a single item — a category, a search result or anything behind a login has
                    no one price to read. If the page is fine and this still fails, the store may be blocking
                    automated reads.
                  </span>
                  <span className="row wrap" style={{ gap: 8 }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => {
                        setResolved({
                          product: blankDetail(errorUrl),
                          strategy: 'entered by hand',
                          warnings: [
                            'Nothing was read from the page — the name and the price below are the ones you type.',
                          ],
                          partial: true,
                        })
                        setError('')
                        setMode('build')
                      }}
                    >
                      Enter it by hand instead
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => {
                        setError('')
                        setQ('')
                        searchInput.current?.focus()
                      }}
                    >
                      Search by name
                    </button>
                  </span>
                </>
              )}
            </span>
          </ErrorNote>
        </div>
      )}

      {loading && (
        <div className="col" style={{ gap: 14 }}>
          <div className="row wrap" style={{ gap: 8 }}>
            <div className="skeleton" style={{ height: 24, width: 190, borderRadius: 999 }} />
            <div className="skeleton" style={{ height: 24, width: 160, borderRadius: 999 }} />
            <div className="skeleton" style={{ height: 24, width: 140, borderRadius: 999 }} />
          </div>
          <ResultsGrid>
            {Array.from({ length: 8 }, (_, i) => (
              <ProductCardSkeleton key={i} />
            ))}
          </ResultsGrid>
        </div>
      )}

      {!loading && resolved && (
        <div className="card card-pad" style={{ marginBottom: 18 }}>
          <div className="row wrap" style={{ gap: 16, alignItems: 'flex-start' }}>
            <div style={{ width: 132, flex: 'none' }}>
              <ProductImage
                src={resolved.product.images[0] ?? resolved.product.image_url}
                alt={resolved.product.title}
                domain={resolved.product.merchant.domain}
                ratio="1 / 1"
                radius="var(--r)"
              />
            </div>
            <div className="grow col" style={{ gap: 8, minWidth: 200 }}>
              <div className="row wrap" style={{ gap: 8 }}>
                {resolved.partial ? (
                  <Badge tone="warn">{resolved.strategy === 'entered by hand' ? 'entered by hand' : 'from search, not the page'}</Badge>
                ) : (
                  <>
                    <Badge tone="brand">read from the link</Badge>
                    {resolved.strategy && <Badge>{resolved.strategy}</Badge>}
                  </>
                )}
                {!resolved.product.in_stock && <Badge tone="warn">out of stock</Badge>}
              </div>
              <h2 style={{ fontSize: 19 }}>{resolved.product.title || 'Untitled item'}</h2>
              {resolved.product.merchant.domain && (
                <span className="mono tiny faint">{resolved.product.merchant.domain}</span>
              )}
              {resolved.product.description && (
                <p className="small muted" style={{ maxWidth: '68ch' }}>
                  {resolved.product.description.slice(0, 240)}
                  {resolved.product.description.length > 240 ? '…' : ''}
                </p>
              )}
              <div className="row wrap" style={{ gap: 12, marginTop: 2 }}>
                <Money
                  minor={resolved.product.price.amount_minor}
                  currency={resolved.product.price.currency}
                  size="lg"
                />
                {resolved.product.variants.length > 1 && (
                  <span className="small muted">{resolved.product.variants.length} variants</span>
                )}
              </div>
              {resolved.warnings.length > 0 && (
                <p className="tiny faint" style={{ lineHeight: 1.6 }}>
                  {resolved.warnings.map((w, i) => (
                    <span key={i} style={{ display: 'block' }}>
                      {w}
                    </span>
                  ))}
                </p>
              )}
              <div className="row wrap" style={{ gap: 8, marginTop: 4 }}>
                <button type="button" className="btn btn-primary btn-lg" onClick={startBuild}>
                  Build the group →
                </button>
                {resolved.product.product_url && (
                  <a
                    className="btn btn-ghost"
                    href={resolved.product.product_url}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    Check the page ↗
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {!loading && results && (
        <div className="col" style={{ gap: 14 }}>
          <div className="row-between wrap" style={{ gap: 10 }}>
            <h2 style={{ fontSize: 17 }}>
              {results.products.length} {results.products.length === 1 ? 'result' : 'results'} for “{results.query}”
              {domainOf(store) && <span className="muted"> on {domainOf(store)}</span>}
            </h2>
          </div>

          <SourceStrip sources={results.sources} tookMs={results.took_ms} />
          <SourceErrors sources={results.sources} />
          {health.length > 0 && <UnavailableSources health={health} />}

          {/* Only worth offering once there is something to compare against.
              One result cannot be cheaper than anything. */}
          {results.products.length > 1 && !results.resolved && (
            <PriceCompare
              key={results.query}
              query={results.query}
              onPick={(url) => void resolveUrl(url, true)}
            />
          )}

          {results.warnings && results.warnings.length > 0 && (
            <p className="tiny faint">{results.warnings.join(' · ')}</p>
          )}

          {results.products.length === 0 && isBareStore(results.query) ? (
            // "amazon.com" is a shop, not a thing to buy. Reporting 0 results
            // is technically true and completely useless — the person told us
            // where, and we said nothing. Tell them what to do instead.
            <Empty
              title={`${results.query} is a store, not an item`}
              action={
                <a
                  className="btn btn-primary"
                  href={`https://${domainOf(results.query)}`}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Open {domainOf(results.query)} ↗
                </a>
              }
            >
              Find the exact thing you want on their site, then copy the address of that page and
              paste it here. Sutra reads the merchant’s own price, currency and options straight off
              it — which is how a store nobody integrated with still works.
            </Empty>
          ) : results.products.length === 0 ? (
            <Empty
              title={`Nothing came back for “${results.query}”`}
              action={
                <div className="row wrap" style={{ gap: 8, justifyContent: 'center' }}>
                  {domainOf(store) && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => {
                        setStore('')
                        void runSearch(results.query, '')
                      }}
                    >
                      Search every store instead
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      setQ('')
                      searchInput.current?.focus()
                    }}
                  >
                    Paste a link instead
                  </button>
                </div>
              }
            >
              The catalogues that answered had nothing matching. Searching only reaches the stores that allow it —
              pasting a link to the exact item works on almost any store, including the ones that never appear
              here.
            </Empty>
          ) : (
            <ResultsGrid>
              {results.products.map((p) => (
                <ProductCard key={`${p.source}-${p.id}`} product={p} onPick={(x) => void pick(x)} busy={picking === p.id} />
              ))}
            </ResultsGrid>
          )}
        </div>
      )}

      {!loading && !results && !resolved && !error && (
        <div style={{ marginTop: 8 }}>
          <HowThisWorksNote />
          {health.length > 0 && (
            <div className="col" style={{ gap: 8, marginTop: 12 }}>
              <div className="row wrap" style={{ gap: 8 }}>
                {health
                  .filter((s) => s.available)
                  .map((s) => (
                    <span key={s.kind} className="chip">
                      <span className="dot dot-brand" />
                      {s.label}
                    </span>
                  ))}
              </div>
              <UnavailableSources health={health} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function DiscoverSkeleton() {
  return (
    <div className="page">
      <div className="page-head col" style={{ gap: 10 }}>
        <Skeleton h={30} w={320} />
        <Skeleton h={15} w={420} />
      </div>
      <div className="skeleton" style={{ height: 108, borderRadius: 16, marginBottom: 18 }} />
      <ResultsGrid>
        {Array.from({ length: 8 }, (_, i) => (
          <ProductCardSkeleton key={i} />
        ))}
      </ResultsGrid>
    </div>
  )
}
