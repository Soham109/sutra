'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { Composer } from '@/components/home/composer'
import { ExposureMeter } from '@/components/home/exposure'
import { NeedsYou } from '@/components/home/needs-you'
import { Waiting } from '@/components/home/waiting'
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
            <Skeleton h={190} />
            <Skeleton h={120} />
            <Skeleton h={90} />
          </div>
        )}

        {data && (
          <>
            <NeedsYou approvals={data.needs_you} plans={data.plans_needing_you} />

            <Composer />

            <ExposureMeter exposure={data.exposure} />

            <Waiting groups={data.waiting_on_others} plans={data.live_plans} />

            {quiet && (
              <section className="quiet-state">
                <div>
                  <span className="eyebrow">All clear</span>
                  <h2>Nobody is waiting on you, and you’re not waiting on anybody.</h2>
                </div>
                <p>
                  Start above and everyone gets their own link. They approve on their own phone, with
                  their own card, and nobody has to front the money.
                </p>
              </section>
            )}

            {data.recent.length > 0 && (
              <section className="settled">
                <div className="section-head">
                  <h2>Settled</h2>
                  <Link href="/app/receipts" className="text-button">
                    All receipts ↗
                  </Link>
                </div>
                <div className="settled-list">
                  {data.recent.map((r) => (
                    <Link href={`/app/receipts/${r.group_id}`} className="settled-row" key={r.group_id}>
                      <span className={`settled-mark settled-${r.status}`} aria-hidden />
                      <span className="settled-title">{r.title}</span>
                      <span className="settled-rail tiny faint">
                        {r.rail === 'at_venue' ? 'paid at venue' : 'card mandates'}
                      </span>
                      <span className="settled-amount amount">
                        {money(r.your_amount, r.currency)}
                      </span>
                      <span className="tiny faint">{relativeTime(r.at)}</span>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            <RhythmStrip data={data} />
          </>
        )}
      </div>
    </Shell>
  )
}

/**
 * Your own record, computed from the event log rather than assigned. Kept to a
 * single quiet line: it is evidence you can point at, not a score to chase.
 */
function RhythmStrip({ data }: { data: Dashboard }) {
  const r = data.reliability
  if (r.groups === 0) return null
  const rate = r.approval_rate === null ? null : Math.round(r.approval_rate * 100)
  const median =
    r.median_latency_s === null
      ? null
      : r.median_latency_s < 90
        ? `${r.median_latency_s}s`
        : `${Math.round(r.median_latency_s / 60)}m`

  return (
    <section className="rhythm">
      <span className="eyebrow">Your record</span>
      <p>
        <b>{r.groups}</b> {r.groups === 1 ? 'group' : 'groups'}
        {rate !== null && (
          <>
            {' · '}
            you approve <b>{rate}%</b> of the time
          </>
        )}
        {median !== null && (
          <>
            {' · '}
            usually within <b>{median}</b>
          </>
        )}
        {r.backstopped_total_minor > 0 && (
          <>
            {' · '}
            you’ve covered <b>{money(r.backstopped_total_minor, 'USD')}</b> for friends
          </>
        )}
      </p>
      <p className="tiny faint">
        Recomputed from the event log every time you look. Private to you, and nobody can edit it —
        only earn it.
      </p>
    </section>
  )
}
