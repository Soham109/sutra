'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { humanError } from '@/components/approve/model'
import { ConsentChain } from '@/components/receipt/chain'
import { type Receipt } from '@/components/receipt/model'
import { StatusBanner, Totals } from '@/components/receipt/parts'
import { ReceiptStyles } from '@/components/receipt/styles'
import { VerifyPanel } from '@/components/receipt/verify'
import { Shell } from '@/components/shell'
import { Empty, ErrorNote, Skeleton } from '@/components/ui'
import { ApiError, api } from '@/lib/api'

/**
 * One receipt. Not a summary of a receipt — the artifact itself, laid out so it
 * reads as a financial document on screen and prints as one on paper.
 */
export default function ReceiptPage() {
  const params = useParams<{ id: string }>()
  const groupId = String(params?.id ?? '')

  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setReceipt(await api.get<Receipt>(`/v1/groups/${groupId}/receipt`))
      setError(null)
      setPending(false)
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setPending(true)
      else setError(humanError(e))
    } finally {
      setLoading(false)
    }
  }, [groupId])

  useEffect(() => {
    void load()
  }, [load])

  const crumbs = (
    <>
      <Link href="/app">Home</Link>
      <span className="sep">/</span>
      <Link href="/app/receipts">Receipts</Link>
      <span className="sep">/</span>
      <span className="here">{receipt?.title ?? 'Receipt'}</span>
    </>
  )

  return (
    <Shell crumbs={crumbs}>
      <ReceiptStyles />
      <div className="page page-narrow rc-page">
        {loading && !receipt && !pending && (
          <div className="stack" style={{ ['--gap' as string]: '16px' }}>
            <Skeleton h={28} w="56%" />
            <Skeleton h={92} />
            <Skeleton h={140} />
            <Skeleton h={220} />
          </div>
        )}

        {error && <ErrorNote>{error}</ErrorNote>}

        {pending && (
          <Empty
            title="No receipt yet"
            action={
              <Link href={`/app/groups/${groupId}`} className="btn btn-secondary">
                Open the group
              </Link>
            }
          >
            This group is still live. Its signed receipt appears after it commits, aborts, or expires.
          </Empty>
        )}

        {receipt && (
          <>
            <div className="page-head">
              <div className="row-between wrap" style={{ gap: 12, alignItems: 'flex-start' }}>
                <div>
                  <div className="eyebrow">Signed receipt</div>
                  <h1 style={{ marginTop: 5 }}>{receipt.title}</h1>
                  <p className="small muted">
                    {receipt.merchant?.name ?? 'unknown merchant'} · issued{' '}
                    {new Date(receipt.issued_at).toLocaleString()}
                  </p>
                  <p className="tiny mono faint" style={{ marginTop: 4, overflowWrap: 'anywhere' }}>
                    {receipt.group_id}
                  </p>
                </div>
                <div className="row rc-noprint no-print" style={{ gap: 8 }}>
                  <a
                    className="btn btn-secondary"
                    href={`/api/v1/groups/${receipt.group_id}/receipt`}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    Raw JSON
                  </a>
                  <button className="btn btn-secondary" onClick={() => window.print()}>
                    Print
                  </button>
                </div>
              </div>
            </div>

            <div className="stack" style={{ ['--gap' as string]: '16px' }}>
              <StatusBanner receipt={receipt} />
              <Totals receipt={receipt} />
              <ConsentChain receipt={receipt} />
              <VerifyPanel receipt={receipt} />
              <p className="tiny faint">Each entry records that person&apos;s own approval, cap, and card charge.</p>
            </div>
          </>
        )}
      </div>
    </Shell>
  )
}
