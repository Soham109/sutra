'use client'

import { useParams } from 'next/navigation'
import { useState } from 'react'
import { ApproveFrame, ApproveSkeleton, BadLink } from '@/components/approve/chrome'
import { AuctionPanel } from '@/components/approve/auction'
import { BeforeYouTap } from '@/components/approve/before-you-tap'
import { DeclineDialog } from '@/components/approve/decline'
import { useDisplayCurrency } from '@/components/approve/fx'
import { ShareHero } from '@/components/approve/hero'
import { useMemberLive } from '@/components/approve/live'
import {
  lostAuction,
  phaseOf,
  previousShare,
  requoteReason,
  ROLE_NOTE,
  type MemberView,
} from '@/components/approve/model'
import { Presence } from '@/components/approve/presence'
import {
  AbortedCard,
  ApprovedCard,
  BackstopCard,
  ChargingCard,
  ClosedCard,
  ItemLines,
  LeftBehindCard,
  ObserverCard,
  OutCard,
  PortalNote,
  Ticket,
} from '@/components/approve/states'
import { ErrorNote, Spinner } from '@/components/ui'
import { money } from '@/lib/format'

/**
 * /a/:memberId — one member, one share, one thumb.
 *
 * This is the only page most people will ever see of sutra, usually on a phone,
 * often in a bar, sometimes slightly drunk. So: no navigation, no dashboard, no
 * dead ends. Whatever has happened to this group, this page says plainly what
 * you owe or what you were charged, and offers exactly one next action.
 */
export default function ApprovalPage() {
  const params = useParams<{ memberId: string }>()
  const memberId = String(params?.memberId ?? '')

  const live = useMemberLive(memberId)
  const [display, setDisplay] = useDisplayCurrency()
  const [declineOpen, setDeclineOpen] = useState(false)

  if (live.loading && !live.view) {
    return (
      <ApproveFrame>
        <ApproveSkeleton />
      </ApproveFrame>
    )
  }

  if (!live.view) {
    return (
      <ApproveFrame>
        <BadLink message={live.error ?? 'This share could not be opened.'} onRetry={() => void live.refresh()} />
      </ApproveFrame>
    )
  }

  const v = live.view
  const phase = phaseOf(v)
  const cur = v.group.currency
  const policy = live.group?.policy ?? null
  const members = live.group?.members ?? []
  const prev = previousShare(live.events, memberId, v.requote_round)
  const reason = requoteReason(live.events, memberId)
  const auction = v.auction && v.auction.contested_items.length > 0 ? v.auction : null
  // The engine stops minting mandate sessions once a group starts charging, so
  // "still deciding" and "already committing" is a real, reachable combination.
  const committing = v.group.status === 'committing'
  const closed = phase === 'deciding' && committing

  const confirmDecline = async () => {
    await live.run('decline')
    setDeclineOpen(false)
  }

  const dock = buildDock()

  return (
    <ApproveFrame dock={dock} live={live.connected ? 'on' : 'off'}>
      <Header v={v} />

      <div key={phase} className="stack" style={{ ['--gap' as string]: '14px' }}>
        {closed && <ClosedCard v={v} />}

        {phase === 'deciding' && !closed && (
          <ShareHero
            v={v}
            policy={policy}
            display={display}
            onDisplay={setDisplay}
            previous={prev}
            requoteReason={reason}
          />
        )}

        {(phase === 'approved' || phase === 'hold') && (
          <>
            <ApprovedCard v={v} held={phase === 'hold'} />
            <ShareSummary v={v} />
          </>
        )}

        {phase === 'charging' && <ChargingCard v={v} />}
        {phase === 'charged' && <Ticket v={v} />}
        {phase === 'out' && <OutCard status={v.status} noBlame={v.group.no_blame} />}
        {phase === 'left-behind' && <LeftBehindCard v={v} />}
        {phase === 'aborted' && <AbortedCard v={v} note={live.group?.decision_note ?? null} />}
        {phase === 'observer' && <ObserverCard v={v} />}

        {ROLE_NOTE[v.role] && phase === 'deciding' && !closed && (
          <p className="small muted">{ROLE_NOTE[v.role]}</p>
        )}

        {auction && phase !== 'aborted' && phase !== 'left-behind' && (
          <AuctionPanel
            auction={auction}
            currency={cur}
            onBid={(sku, amount) => void live.bid(sku, amount)}
            busy={live.busy === 'bid'}
            lost={lostAuction(live.events, memberId)}
          />
        )}

        {(phase === 'deciding' || phase === 'approved' || phase === 'hold') && !committing && (
          <BackstopCard v={v} />
        )}

        {/* Answers the three things somebody actually wonders in the seconds
            before tapping a payment button on a stranger's link. Card rail
            only: on at_venue there is no redirect and no cap to explain, and
            borrowing this copy there would describe a charge that never
            happens. */}
        {phase === 'deciding' && !closed && v.action === 'approve' && <BeforeYouTap v={v} />}

        {members.length > 0 && phase !== 'charged' && (
          <Presence members={members} meId={memberId} currency={cur} anonymise={v.group.no_blame} />
        )}

        {phase === 'charged' && members.length > 0 && (
          <>
            <Presence members={members} meId={memberId} currency={cur} anonymise={v.group.no_blame} />
            {v.rail === 'prava_mandates' && <PortalNote />}
          </>
        )}

        {(phase === 'approved' || phase === 'hold') && committing && (
          <p className="small muted">
            The policy passed and the group is committing. Your share is queued to be charged against the
            mandate you already approved, so holding and withdrawing are closed now.
          </p>
        )}

        {(phase === 'approved' || phase === 'hold') && !committing && (
          <div className="col" style={{ gap: 8 }}>
            {phase === 'approved' ? (
              <button
                className="btn btn-secondary btn-block"
                disabled={live.busy === 'hold'}
                onClick={() => void live.run('hold')}
              >
                {live.busy === 'hold' ? 'Pausing…' : 'Hold my share (pauses the mandate)'}
              </button>
            ) : null}
            <button className="btn btn-danger btn-block" onClick={() => setDeclineOpen(true)}>
              Withdraw my approval
            </button>
            <p className="tiny faint">
              Holding pauses your mandate and counts as <b>not approved</b> while the group decides. Withdrawing
              cancels it outright.
            </p>
          </div>
        )}

        {live.error && live.view && (
          <p className="tiny faint">
            Live updates are having trouble: {live.error} Your share is unaffected.
          </p>
        )}

        {live.actionError && <ErrorNote>{live.actionError}</ErrorNote>}

        <Footer />
      </div>

      {declineOpen && (
        <DeclineDialog
          policy={policy}
          you={v.name}
          busy={live.busy === 'decline'}
          onClose={() => setDeclineOpen(false)}
          onConfirm={() => void confirmDecline()}
        />
      )}
    </ApproveFrame>
  )

  function buildDock(): React.ReactNode {
    if (phase === 'deciding' && !closed) {
      // On the at_venue rail there is no mandate to mint and no passkey page to
      // send anyone to. The button says what actually happens, and never
      // borrows the card rail's language.
      if (v.action === 'accept') {
        return (
          <div className="col" style={{ gap: 8 }}>
            <button
              className="btn btn-primary btn-block btn-xl"
              disabled={live.busy === 'accept'}
              onClick={() => void live.run('accept')}
            >
              {live.busy === 'accept'
                ? 'Recording…'
                : `That's right — I owe ${money(v.share_amount, cur)}`}
            </button>
            <p className="tiny faint" style={{ textAlign: 'center' }}>
              No card is charged here. You pay {v.group.merchant.name} directly.
            </p>
            <button className="btn btn-ghost btn-block" onClick={() => setDeclineOpen(true)}>
              That&apos;s not right — I&apos;m out
            </button>
          </div>
        )
      }

      const ready = Boolean(v.approval_url)
      return (
        <div className="col" style={{ gap: 8 }}>
          <button
            className="btn btn-primary btn-block btn-xl"
            disabled={!ready}
            onClick={() => {
              if (v.approval_url) window.location.href = v.approval_url
            }}
          >
            <span aria-hidden>🔑</span> Approve {money(v.share_amount, cur)} with passkey
          </button>
          {ready ? (
            <p className="tiny faint" style={{ textAlign: 'center' }}>
              Takes you to <b>prava.space</b> to confirm. Your passkey never touches sutra.
            </p>
          ) : (
            <div className="row" style={{ justifyContent: 'center' }}>
              {/* "Preparing your mandate" is a word from the protocol, read by
                  somebody who has never met it. Say what is happening. */}
              <Spinner label="Setting up your approval…" />
            </div>
          )}
          <button className="btn btn-ghost btn-block" onClick={() => setDeclineOpen(true)}>
            I&apos;m out — decline
          </button>
        </div>
      )
    }

    if (phase === 'hold' && !committing) {
      return (
        <button
          className="btn btn-primary btn-block btn-xl"
          disabled={live.busy === 'resume'}
          onClick={() => void live.run('resume')}
        >
          {live.busy === 'resume' ? 'Resuming…' : 'Resume — count me back in'}
        </button>
      )
    }

    return null
  }
}

function Header({ v }: { v: MemberView }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="eyebrow">Group buy</div>
      <h1 className="ap-title" style={{ marginTop: 4 }}>
        {v.group.title}
      </h1>
      <div className="small muted">
        {v.group.merchant.name} · {v.group.policy_text}
      </div>
    </div>
  )
}

/** After approving, the numbers stay on the page — you can still check them. */
function ShareSummary({ v }: { v: MemberView }) {
  return (
    <section className="card card-pad">
      <div className="row-between">
        <span className="eyebrow">Your share</span>
        <span className="amount">{money(v.share_amount, v.group.currency)}</span>
      </div>
      <div className="row-between" style={{ marginTop: 6 }}>
        <span className="small muted">Cap enforced at the network</span>
        <span className="amount muted">{money(v.cap_amount, v.group.currency)}</span>
      </div>
      <ItemLines items={v.my_items} currency={v.group.currency} />
    </section>
  )
}

function Footer() {
  return (
    <p className="tiny faint" style={{ textAlign: 'center', padding: '10px 0 4px' }}>
      Everyone approves their own share on their own card. No pooled funds, nobody fronts the money.
    </p>
  )
}
