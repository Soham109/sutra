'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { Shell } from '@/components/shell'
import {
  ConsentThread,
  Countdown,
  ErrorNote,
  Money,
  PolicyChip,
  Skeleton,
} from '@/components/ui'
import { GroupStyles } from '@/components/group/styles'
import { GroupBadge, STRAGGLER_LABEL } from '@/components/group/badges'
import { AuctionPanel } from '@/components/group/AuctionPanel'
import { BackstopMoment } from '@/components/group/BackstopMoment'
import { CancelGroup } from '@/components/group/CancelGroup'
import { EventLog } from '@/components/group/EventLog'
import { MemberPanel } from '@/components/group/MemberPanel'
import { InvitePanel } from '@/components/group/InvitePanel'
import { ReplayBar, type Speed } from '@/components/group/Replay'
import { TerminalBanner } from '@/components/group/TerminalBanner'
import { WhatNow } from '@/components/group/WhatNow'
import { ChatThread } from '@/components/chat/ChatThread'
import { BACKSTOP_MOMENTS, deriveAt, fromGroup, pNum, pStr } from '@/components/group/derive'
import { short } from '@/components/group/narrate'
import { useGroupStream } from '@/lib/useGroupStream'
import { money, progressOf } from '@/lib/format'
import type { GroupStatus } from '@/lib/api'

// The war room. One group, its whole state machine, live — and because the log
// is append-only, the same screen replays the finished group beat by beat.

const TERMINAL = new Set<GroupStatus>(['committed', 'partial', 'aborted', 'expired'])

interface Moment {
  seq: number
  name: string
  amount: number
  shortfall: number
  settled: boolean
}

export default function GroupWarRoom() {
  const params = useParams<{ id: string }>()
  const id = typeof params?.id === 'string' ? params.id : ''
  const { group, events, loading, error, stream, refresh, applyGroup } = useGroupStream(id)

  const [replay, setReplay] = useState(false)
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<Speed>(1)
  const [moment, setMoment] = useState<Moment | null>(null)

  // Replay clock.
  useEffect(() => {
    if (!replay || !playing) return
    if (index >= events.length) {
      setPlaying(false)
      return
    }
    const t = setTimeout(() => setIndex((i) => Math.min(events.length, i + 1)), 750 / speed)
    return () => clearTimeout(t)
  }, [replay, playing, index, events.length, speed])

  const view = useMemo(() => {
    if (!group) return null
    if (replay) return deriveAt(group, events, index)
    return events.length > 0 ? deriveAt(group, events) : fromGroup(group)
  }, [group, events, replay, index])

  const visible = useMemo(() => (replay ? events.slice(0, index) : events), [replay, index, events])
  const head = visible.length > 0 ? visible[visible.length - 1] : null
  const headSeq = head?.seq ?? 0

  // The backstop moment: fires the instant the event lands, live or in replay.
  useEffect(() => {
    if (head && BACKSTOP_MOMENTS.has(head.type)) {
      const p = head.payload ?? {}
      setMoment({
        seq: head.seq,
        name: pStr(p, 'name') ?? 'A member',
        amount: pNum(p, 'amount') ?? 0,
        shortfall: pNum(p, 'shortfall') ?? 0,
        settled: head.type === 'backstop.absorbed',
      })
      return
    }
    // Scrubbing back before the transfer un-does it, like everything else here.
    setMoment((m) => (m && m.seq > headSeq ? null : m))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headSeq])

  useEffect(() => {
    if (!moment) return
    const t = setTimeout(() => setMoment(null), 12000)
    return () => clearTimeout(t)
  }, [moment])

  if (loading && !group) {
    return (
      <Shell crumbs={<Crumbs title="Loading…" />}>
        <GroupStyles />
        <div className="page stack">
          <div className="card card-pad col" style={{ gap: 12 }}>
            <Skeleton h={26} w="46%" />
            <Skeleton h={14} w="28%" />
            <Skeleton h={64} />
          </div>
          <div className="gr-grid">
            <div className="card card-pad col" style={{ gap: 10 }}>
              <Skeleton h={92} />
              <Skeleton h={200} />
            </div>
            <div className="card card-pad col" style={{ gap: 10 }}>
              <Skeleton h={120} />
              <Skeleton h={120} />
            </div>
          </div>
        </div>
      </Shell>
    )
  }

  if (error && !group) {
    return (
      <Shell crumbs={<Crumbs title="Group" />}>
        <GroupStyles />
        <div className="page page-narrow">
          <ErrorNote>
            {error}{' '}
            <Link href="/app/groups" className="btn btn-ghost tiny">
              Back to your groups
            </Link>
          </ErrorNote>
        </div>
      </Shell>
    )
  }

  if (!group || !view) return null

  const currency = group.currency
  const { done, total: payers } = progressOf(view.members)
  const status = view.status
  const showBanner = TERMINAL.has(status)
  const collecting = status === 'collecting' || status === 'deciding'
  const auction = group.auction ?? (view.auctionClosesAt ? { closes_at: view.auctionClosesAt, open: !view.auctionClosed } : null)
  const cartHash = view.cartHash ?? group.cart_hash

  return (
    <Shell crumbs={<Crumbs title={group.title} />}>
      <GroupStyles />
      <div className="page stack" style={{ ['--gap' as string]: '16px' }}>
        {/* --- header --------------------------------------------------- */}
        <div className="card card-pad">
          <div className="gr-head">
            <div className="gr-head-main">
              <div className="row wrap" style={{ gap: 8, marginBottom: 6 }}>
                <GroupBadge status={status} live={!group.terminal && !replay} />
                {replay && <span className="badge badge-warn">Replay</span>}
                {view.haltedAfter && <span className="badge badge-warn">Halted</span>}
                {group.no_blame && <span className="badge">No blame</span>}
              </div>
              <h1 style={{ overflowWrap: 'anywhere' }}>{group.title}</h1>
              <p className="small muted" style={{ marginTop: 4 }}>
                {/^https?:\/\//i.test(group.merchant.url) &&
                !/\.(local\.)?test(\/|$)/i.test(group.merchant.url) ? (
                  <a href={group.merchant.url} target="_blank" rel="noreferrer" style={{ color: 'var(--brand)' }}>
                    {group.merchant.name} ↗
                  </a>
                ) : (
                  <span>{group.merchant.name}</span>
                )}
                <span className="faint"> · {group.merchant.country_code_iso2}</span>
                {/* The cart hash used to sit here, in the second line of the
                    page, reading "cart 4453d67b…5792". It is what makes the
                    receipt tamper-evident and it belongs on the receipt, not
                    in the headline of a page somebody opened to find out who
                    still owes them money. */}
              </p>
            </div>

            <div className="gr-head-side">
              <Money minor={group.total} currency={currency} size="lg" />
              <span className="tiny mono faint">
                {done}/{payers} approved
              </span>
              {collecting && !replay && <Countdown to={group.deadline_at} />}
              <div className="row" style={{ gap: 8 }}>
                {!replay && <CancelGroup group={group} onGroup={applyGroup} />}
                {group.terminal && (
                  <Link className="btn btn-secondary" href={`/app/receipts/${group.group_id}`}>
                    Receipt
                  </Link>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* --- the end of the story ------------------------------------- */}
        {showBanner && (
          <TerminalBanner
            status={status}
            decisionNote={replay ? view.decisionNote : group.decision_note}
            narrative={view.narrative}
            members={view.members}
            currency={currency}
            groupId={group.group_id}
            charges={group.rail_capability?.charges ?? group.rail !== 'at_venue'}
            merchant={group.merchant.name}
          />
        )}

        {/* --- the backstop moment -------------------------------------- */}
        {moment && (
          <BackstopMoment
            key={moment.seq}
            name={moment.name}
            amount={moment.amount}
            shortfall={moment.shortfall}
            settled={moment.settled}
            total={group.total}
            currency={currency}
            onDismiss={() => setMoment(null)}
          />
        )}

        {/* Who we are waiting on and whether any money has moved — the two
            things somebody opens this page to find out, above everything the
            protocol wants to tell them about itself. */}
        {!replay && (
          <WhatNow
            status={status}
            members={view.members}
            currency={currency}
            groupId={group.group_id}
            charges={group.rail_capability?.charges ?? group.rail !== 'at_venue'}
            terminal={group.terminal}
          />
        )}

        <div className="gr-grid">
          {/* --- left: the thread and the log --------------------------- */}
          <div className="stack" style={{ ['--gap' as string]: '16px' }}>
            <div className="card card-pad gr-flip" key={`thread-${status}`}>
              <div className="row-between" style={{ marginBottom: 2 }}>
                <span className="eyebrow">Who has approved</span>
                <span className="tiny faint">
                  {status === 'committing'
                    ? 'Charging every card at once'
                    : collecting
                      ? 'Each node fills only when that person approves their own share'
                      : 'Final positions'}
                </span>
              </div>
              <ConsentThread members={view.members} currency={currency} anonymiseDeclines={group.no_blame} />
            </div>

            <div className="card">
              <div className="gr-sec">
                <h3>What happened, in order</h3>
                <span className="row tiny" style={{ gap: 7 }}>
                  {replay ? (
                    <span className="faint mono">replaying {visible.length}/{events.length}</span>
                  ) : stream === 'live' ? (
                    <>
                      <span className="dot dot-brand dot-live" />
                      <span className="faint mono">live</span>
                    </>
                  ) : stream === 'retrying' ? (
                    <>
                      <span className="dot dot-warn" />
                      <span className="faint mono">reconnecting…</span>
                    </>
                  ) : (
                    <>
                      <span className="dot" />
                      <span className="faint mono">connecting…</span>
                    </>
                  )}
                </span>
              </div>

              <EventLog
                events={visible}
                currency={currency}
                noBlame={group.no_blame}
                follow={!replay}
                cursorSeq={replay && head ? head.seq : undefined}
              />

              <ReplayBar
                active={replay}
                index={index}
                events={events}
                playing={playing}
                speed={speed}
                onEnter={() => {
                  setReplay(true)
                  setIndex(0)
                  setPlaying(true)
                  setMoment(null)
                }}
                onLive={() => {
                  setReplay(false)
                  setPlaying(false)
                  setMoment(null)
                  void refresh()
                }}
                onScrub={(i) => {
                  setPlaying(false)
                  setIndex(i)
                }}
                onPlay={() => setPlaying((p) => !p)}
                onStep={(d) => {
                  setPlaying(false)
                  setIndex((i) => Math.max(0, Math.min(events.length, i + d)))
                }}
                onSpeed={setSpeed}
              />
            </div>

            {error && group && (
              <ErrorNote>
                {error}{' '}
                <button className="btn btn-ghost tiny" onClick={() => void refresh()}>
                  Retry
                </button>
              </ErrorNote>
            )}

            {!replay && <ChatThread scope="group" id={group.group_id} />}
          </div>

          {/* --- right: who, what, and under which rule ------------------ */}
          <div className="stack" style={{ ['--gap' as string]: '16px' }}>
            {collecting && !replay ? <InvitePanel groupId={group.group_id} title={group.title} /> : null}
            <MemberPanel
              members={view.members}
              currency={currency}
              merchant={group.merchant.name}
              allocations={view.allocations}
              anonymise={group.no_blame}
              replaying={replay}
              charges={group.rail_capability?.charges ?? group.rail !== 'at_venue'}
            />

            <div className="card">
              <div className="gr-sec">
                <h3>The rule</h3>
                {view.deadlineReached && <span className="badge badge-warn">Deadline passed</span>}
              </div>
              <div style={{ padding: 16 }}>
                <PolicyChip policy={group.policy} />
                <div style={{ marginTop: 12 }}>
                  <div className="gr-line">
                    <span className="muted">Deadline</span>
                    <span className="mono tiny">{new Date(group.deadline_at).toLocaleString()}</span>
                  </div>
                  <div className="gr-line">
                    <span className="muted">Price may drift by</span>
                    <span className="mono tiny">{(group.tolerance_bps / 100).toFixed(2)}%</span>
                  </div>
                  <div className="gr-line">
                    <span className="muted">If somebody never answers</span>
                    <span className="tiny" style={{ textAlign: 'right' }}>
                      {STRAGGLER_LABEL[group.straggler_policy] ?? group.straggler_policy}
                    </span>
                  </div>
                  <div className="gr-line">
                    <span className="muted">If somebody says no</span>
                    <span className="tiny" style={{ textAlign: 'right' }}>
                      {group.no_blame ? 'Declines stay anonymous' : 'Declines are attributed'}
                    </span>
                  </div>
                  {group.fx && (
                    <div className="gr-line">
                      <span className="muted">FX pinned</span>
                      <span className="mono tiny" title={group.fx.source}>
                        {group.fx.base} · {new Date(group.fx.at).toLocaleString()}
                      </span>
                    </div>
                  )}
                </div>
                {group.policy_text && (
                  <p className="small muted" style={{ marginTop: 12 }}>
                    {group.policy_text}
                  </p>
                )}
              </div>
            </div>

            <div className="card">
              <div className="gr-sec">
                <h3>Cart</h3>
                <span className="tiny mono faint gr-break" title={cartHash}>
                  {short(cartHash, 8)}
                </span>
              </div>
              <div style={{ padding: '10px 16px 16px' }}>
                {group.cart.items.map((it) => (
                  <div className="gr-line" key={it.sku}>
                    <span style={{ minWidth: 0 }}>
                      {it.qty > 1 && <span className="mono tiny faint">{it.qty}× </span>}
                      {it.name}
                      {it.contested && <span className="badge badge-warn" style={{ marginLeft: 6 }}>Contested</span>}
                      {it.tier === 'extra' && <span className="badge" style={{ marginLeft: 6 }}>Extra</span>}
                    </span>
                    <span className="amount" style={{ fontSize: 13 }}>
                      {money(it.unit_amount * it.qty, currency)}
                    </span>
                  </div>
                ))}
                {group.cart.fees.map((f) => (
                  <div className="gr-line" key={f.name}>
                    <span className="muted">{f.name}</span>
                    <span className="amount muted" style={{ fontSize: 13 }}>
                      {money(f.amount, currency)}
                    </span>
                  </div>
                ))}
                <div className="gr-line">
                  <span style={{ fontWeight: 550 }}>Total</span>
                  <span className="amount">{money(group.total, currency)}</span>
                </div>
              </div>
            </div>

            {auction && (
              <AuctionPanel
                closesAt={auction.closes_at}
                open={auction.open && !view.auctionClosed}
                items={view.auctionItems}
                reveals={view.reveals}
                bids={view.bids}
                currency={currency}
              />
            )}

            {group.terminal && (
              <div className="card card-pad">
                <span className="eyebrow">Receipt</span>
                <p className="small muted" style={{ margin: '6px 0 12px' }}>
                  A hash-chained record of every consent and every charge, signed by the engine. It verifies without
                  trusting this app.
                </p>
                {view.chainHead && (
                  <div className="well mono tiny gr-break" style={{ marginBottom: 12 }}>
                    chain head {view.chainHead}
                  </div>
                )}
                <div className="row wrap" style={{ gap: 10 }}>
                  <Link className="btn btn-primary" href={`/app/receipts/${group.group_id}`}>
                    Open receipt
                  </Link>
                  <a
                    className="btn btn-secondary"
                    href={`/api/v1/groups/${group.group_id}/receipt`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Signed JSON ↗
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </Shell>
  )
}

function Crumbs({ title }: { title: string }) {
  return (
    <>
      <Link href="/app/groups">Groups</Link>
      <span className="sep">/</span>
      <span className="here" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {title}
      </span>
    </>
  )
}
