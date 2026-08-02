'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { Composer } from '@/components/home/composer'
import { ExposureMeter } from '@/components/home/exposure'
import { NeedsYou } from '@/components/home/needs-you'
import { Waiting } from '@/components/home/waiting'
import { StatRow } from '@/components/home/stat-row'
import { ReliabilityPanel } from '@/components/home/reliability'
import { SettlementHistory } from '@/components/home/settlement-history'
import { Shell } from '@/components/shell'
import { ErrorNote, Skeleton } from '@/components/ui'
import { money, relativeTime } from '@/lib/format'
import { api, type Dashboard } from '@/lib/api'

// The command centre.
//
// It answers two questions and nothing else: what needs me, and what is my
// money doing. Anything that explains the product belongs on the marketing
// page — a person who is signed in has already been sold.

export default function HomePage() {
  const [data, setData] = useState<Dashboard | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      setData(await api.get<Dashboard>('/v1/my/dashboard'))
    } catch (cause) {
      setError((cause as Error).message)
    }
  }, [])

  useEffect(() => {
    void load()
    // Approvals land on other people's phones; this page has to notice.
    const id = setInterval(() => void load(), 5000)
    const onFocus = () => void load()
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(id)
      window.removeEventListener('focus', onFocus)
    }
  }, [load])

  const quiet =
    data !== null &&
    data.needs_you.length === 0 &&
    data.plans_needing_you.length === 0 &&
    data.waiting_on_others.length === 0 &&
    data.live_plans.length === 0

  return (
    <Shell crumbs={<span className="here">Today</span>}>
      <div className="page home-page">
        <Composer />

        {error && (
          <ErrorNote>
            Couldn’t load your dashboard — {error}.{' '}
            <button className="text-button" onClick={() => void load()}>
              Try again
            </button>
          </ErrorNote>
        )}

        {data === null && !error && (
          <div className="home-loading">
            <Skeleton h={86} />
            <Skeleton h={190} />
            <Skeleton h={120} />
            <Skeleton h={90} />
          </div>
        )}

        {data && (
          <>
            <NeedsYou approvals={data.needs_you} plans={data.plans_needing_you} />

            <Waiting groups={data.waiting_on_others} plans={data.live_plans} />

            {quiet && (
              <section className="quiet-state">
                <div>
                  <span className="eyebrow">All clear</span>
                  <h2>Nothing needs you right now.</h2>
                </div>
                <p>
                  Start above with an idea, link, or receipt. Friends with accounts are notified; anyone else can
                  join by private link. A bill split records agreement only — everyone pays the venue themselves.
                </p>
              </section>
            )}

            <section className="settled">
              <div className="section-head">
                <h2>Completed records</h2>
                <Link href="/app/receipts" className="text-button">
                  All receipts ↗
                </Link>
              </div>
              <SettlementHistory recent={data.recent} />
              {data.recent.length > 0 && (
                <div className="settled-list">
                  {data.recent.map((r) => (
                    <Link href={`/app/receipts/${r.group_id}`} className="settled-row" key={r.group_id}>
                      <span className={`settled-mark settled-${r.status}`} aria-hidden />
                      <span className="settled-title">{r.title}</span>
                      <span className="settled-rail tiny faint">
                        {r.amount_kind === 'not_completed'
                          ? 'not completed'
                          : r.rail === 'at_venue'
                          ? 'agreed · pay venue'
                          : r.rail === 'shopify_pos'
                            ? 'ready for Shopify POS'
                            : r.rail === 'checkout_handoff'
                              ? 'checkout pending'
                              : 'charged to your card'}
                      </span>
                      <span className="settled-amount amount">
                        {money(r.your_amount, r.currency)}
                      </span>
                      <span className="tiny faint">{relativeTime(r.at)}</span>
                    </Link>
                  ))}
                </div>
              )}
            </section>

            <details className="home-secondary">
              <summary>
                <span><b>Activity and card status</b><small>Limits, history, and reliability</small></span>
                <span aria-hidden>↓</span>
              </summary>
              <div className="home-secondary-body">
                <StatRow data={data} />
                <ExposureMeter exposure={data.exposure} />
                <ReliabilityPanel reliability={data.reliability} />
              </div>
            </details>
          </>
        )}
      </div>
    </Shell>
  )
}
