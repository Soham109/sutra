'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { humanError } from '@/components/approve/model'
import { shortHash, type Receipt } from '@/components/receipt/model'
import { GroupStatusBadge } from '@/components/receipt/parts'
import { ProvenChargeNote } from '@/components/receipt/proven-charge'
import { useSession } from '@/components/session'
import { Shell } from '@/components/shell'
import { Empty, ErrorNote, Money, Skeleton } from '@/components/ui'
import { api, type Group } from '@/lib/api'
import { relativeTime } from '@/lib/format'

interface Row {
  group: Group
  receipt: Receipt | null
}

/**
 * Every group that ended, and the artifact it left behind. Live groups are not
 * here on purpose: a receipt only exists once nothing more can change.
 */
export default function ReceiptsPage() {
  const { user, loading: sessionLoading } = useSession()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    let alive = true

    const load = async () => {
      try {
        const { groups } = await api.get<{ groups: Group[] }>('/v1/my/groups')
        const terminal = groups.filter((g) => g.terminal)
        const receipts = await Promise.all(
          terminal.map(async (g) => {
            try {
              return await api.get<Receipt>(`/v1/groups/${g.group_id}/receipt`)
            } catch {
              return null
            }
          }),
        )
        if (!alive) return
        const next = terminal
          .map((group, i) => ({ group, receipt: receipts[i] ?? null }))
          .sort((a, b) => issuedAt(b) - issuedAt(a))
        setRows(next)
        setError(null)
      } catch (e) {
        if (alive) setError(humanError(e))
      }
    }

    void load()
    return () => {
      alive = false
    }
  }, [user])

  return (
    <Shell
      crumbs={
        <>
          <Link href="/app">Home</Link>
          <span className="sep">/</span>
          <span className="here">Receipts</span>
        </>
      }
    >
      <div className="page page-narrow">
        <div className="page-head">
          <h1>Receipts</h1>
          <p className="small muted">
            A verifiable record of consent and outcome: what was charged, what was only agreed, and what still
            needs a merchant checkout or till.
          </p>
        </div>

        <ProvenChargeNote />

        {error && <ErrorNote>{error}</ErrorNote>}

        {(!rows || sessionLoading) && !error && (
          <div className="card col" style={{ gap: 0 }}>
            {[0, 1, 2].map((i) => (
              <div className="list-row" key={i}>
                <div className="grow col" style={{ gap: 7 }}>
                  <Skeleton h={15} w="52%" />
                  <Skeleton h={11} w="34%" />
                </div>
                <Skeleton h={20} w={78} />
              </div>
            ))}
          </div>
        )}

        {rows && rows.length === 0 && !error && (
          <Empty
            title="No receipts yet"
            action={
              <Link href="/app" className="btn btn-primary">
                Start a group
              </Link>
            }
          >
            Finish a group and its signed consent record will appear here, including groups that abort or expire.
          </Empty>
        )}

        {rows && rows.length > 0 && (
          <div className="card">
            {rows.map(({ group, receipt }) => {
              const charged =
                receipt?.totals.charged ?? group.members.reduce((s, m) => s + m.charged_amount, 0)
              const recorded = charged || receipt?.totals.owed || group.members.reduce((s, m) => s + m.share_amount, 0)
              const when = receipt?.issued_at ?? group.deadline_at
              return (
                <Link key={group.group_id} href={`/app/receipts/${group.group_id}`} className="list-row">
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="row wrap" style={{ gap: 8 }}>
                      <span style={{ fontWeight: 550 }}>{group.title}</span>
                      <GroupStatusBadge status={group.status} />
                    </div>
                    <div className="tiny faint">
                      {group.merchant.name} · {new Date(when).toLocaleDateString([], { month: 'short', day: 'numeric' })}{' '}
                      · {relativeTime(when)}
                    </div>
                    <div className="tiny mono faint" title={receipt?.chain_head}>
                      {receipt ? shortHash(receipt.chain_head, 16, 0) : 'receipt unavailable'}
                    </div>
                  </div>
                  <div className="col" style={{ alignItems: 'flex-end', gap: 3 }}>
                    <Money minor={recorded} currency={group.currency} />
                    <span className="tiny faint">
                      {charged > 0 ? 'charged' : group.rail === 'shopify_pos' ? 'ready for POS' : group.rail === 'checkout_handoff' ? 'checkout pending' : 'agreed only'}
                    </span>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </Shell>
  )
}

function issuedAt(row: Row): number {
  return new Date(row.receipt?.issued_at ?? row.group.deadline_at).getTime()
}
