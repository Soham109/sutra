'use client'

import type { GmpEvent } from '@/lib/api'
import { clockTime, money } from '@/lib/format'
import { pArr, pNum, pRates, pStr, type Payload } from './derive'

// Every protocol event, rendered as a sentence a person can read. This is the
// whole promise of the product: the machine's own log, legible, with the facts
// (amounts, ids, hashes) still set in mono so they stay verifiable.

export type Tone = 'ok' | 'bad' | 'warn' | 'brand' | 'plain'

const TONES: Record<string, Tone> = {
  'group.created': 'brand',
  'group.decision': 'brand',
  'group.committing': 'brand',
  'group.committed': 'ok',
  'group.partial': 'warn',
  'group.aborted': 'bad',
  'group.expired': 'bad',
  'group.deadline': 'warn',
  'group.halted': 'warn',
  'member.invited': 'plain',
  'member.viewed': 'plain',
  'member.session_created': 'warn',
  'member.approved': 'brand',
  'member.declined': 'bad',
  'member.dropped': 'bad',
  'member.requoted': 'warn',
  'member.held': 'warn',
  'member.resumed': 'brand',
  'member.charging': 'brand',
  'member.charged': 'ok',
  'member.failed': 'bad',
  'backstop.armed': 'brand',
  'backstop.allocated': 'warn',
  'backstop.absorbed': 'ok',
  'backstop.failed': 'bad',
  'charge.attempted': 'plain',
  'charge.succeeded': 'ok',
  'charge.failed': 'bad',
  'charge.unknown': 'warn',
  'charge.settlement_pending': 'warn',
  'auction.opened': 'brand',
  'auction.bid': 'plain',
  'auction.reveal': 'brand',
  'auction.lost': 'warn',
  'auction.closed': 'plain',
  'cart.adjusted': 'warn',
  'fx.snapshot': 'plain',
  'receipt.issued': 'ok',
}

export function eventTone(type: string): Tone {
  return TONES[type] ?? 'plain'
}

/** Long ids and hashes stay verifiable but never hijack a line. */
export function short(v: string, keep = 8): string {
  if (v.length <= keep * 2 + 1) return v
  return `${v.slice(0, keep)}…${v.slice(-4)}`
}

function M({ children, full }: { children: React.ReactNode; full?: string }) {
  return (
    <span className="mono" title={full}>
      {children}
    </span>
  )
}

function A({ minor, currency }: { minor: number; currency: string }) {
  return <span className="amount">{money(minor, currency)}</span>
}

function nameOf(p: Payload, noBlame: boolean, hide = false): string {
  if (noBlame && hide) return 'A member'
  return pStr(p, 'name') ?? 'A member'
}

function sourceWord(s: string | null): string {
  if (s === 'backstop') return 'backstop mandate'
  if (s === 'share') return 'own mandate'
  return s ?? 'mandate'
}

export interface NarrateOpts {
  currency: string
  noBlame: boolean
}

/** One event → one sentence. No raw JSON ever reaches the screen. */
export function narrate(e: GmpEvent, { currency, noBlame }: NarrateOpts): React.ReactNode {
  const p: Payload = e.payload ?? {}
  const n = (hide = false) => nameOf(p, noBlame, hide)

  switch (e.type) {
    case 'group.created': {
      const total = pNum(p, 'total')
      const dl = pStr(p, 'deadline_at')
      return (
        <>
          Group opened — <b>{pStr(p, 'title') ?? 'a group buy'}</b>
          {total !== null && (
            <>
              , <A minor={total} currency={pStr(p, 'currency') ?? currency} /> on the table
            </>
          )}
          . Rule: {pStr(p, 'policy') ?? 'as configured'}
          {dl && <>. Everyone has until {clockTime(dl)}</>}.
        </>
      )
    }
    case 'member.invited': {
      const share = pNum(p, 'share')
      return (
        <>
          {n()} was invited as {pStr(p, 'role') ?? 'payer'}
          {share !== null && (
            <>
              , quoted <A minor={share} currency={currency} />
            </>
          )}
          .
        </>
      )
    }
    case 'member.viewed':
      return <>{n()} opened the request.</>
    case 'member.session_created': {
      const cap = pNum(p, 'cap')
      const round = pNum(p, 'round') ?? pNum(p, 'requote_round')
      return (
        <>
          {n()} started a Prava session on their own device
          {cap !== null && (
            <>
              , capped at <A minor={cap} currency={currency} />
            </>
          )}
          {round ? <> (round {round})</> : null}.
        </>
      )
    }
    case 'member.approved': {
      const share = pNum(p, 'share')
      const cap = pNum(p, 'cap')
      const mandate = pStr(p, 'mandate_id')
      return (
        <>
          {n()} approved their own {share !== null ? <A minor={share} currency={currency} /> : 'share'}
          {cap !== null && (
            <>
              {' '}
              under a <A minor={cap} currency={currency} /> cap
            </>
          )}
          .{' '}
          {mandate && (
            <>
              Mandate <M full={mandate}>{short(mandate)}</M>.
            </>
          )}
        </>
      )
    }
    case 'member.declined': {
      const reason = pStr(p, 'reason')
      return (
        <>
          {n(true)} declined
          {reason === 'external_cancel' ? ' — the mandate was cancelled on Prava' : ''}. Nobody else is charged for it.
        </>
      )
    }
    case 'member.dropped': {
      const reason = pStr(p, 'reason')
      return (
        <>
          {n(true)} was dropped from the group
          {reason === 'auction' ? ' after losing the sealed bid' : reason ? ` — ${reason}` : ''}.
        </>
      )
    }
    case 'member.requoted': {
      const share = pNum(p, 'new_share')
      const round = pNum(p, 'round')
      return (
        <>
          {n()} was re-quoted to {share !== null ? <A minor={share} currency={currency} /> : 'a new share'}
          {round !== null && <> (round {round})</>}
          {pStr(p, 'reason') ? ` — ${pStr(p, 'reason')}` : ''}. They approve again, or nothing moves.
        </>
      )
    }
    case 'member.held':
      return <>{n()} is on hold — nothing moves for them until someone resumes it.</>
    case 'member.resumed':
      return <>{n()} resumed. The group is live again for them.</>
    case 'member.charging':
      return <>Charging {n()}&rsquo;s own card now.</>
    case 'member.charged': {
      const amount = pNum(p, 'amount')
      const txn = pStr(p, 'txn_id')
      return (
        <>
          {n()} paid {amount !== null ? <A minor={amount} currency={currency} /> : 'their share'} on their own card.
          {txn && (
            <>
              {' '}
              <M full={txn}>{short(txn)}</M>
            </>
          )}
        </>
      )
    }
    case 'member.failed':
      return (
        <>
          {n()}&rsquo;s charge failed
          {pStr(p, 'reason') ? <> — {pStr(p, 'reason')}</> : ''}.
        </>
      )
    case 'backstop.armed': {
      const cap = pNum(p, 'cap')
      return (
        <>
          {n()} armed a backstop, good for up to{' '}
          {cap !== null ? <A minor={cap} currency={currency} /> : 'their cap'} if someone falls short.
        </>
      )
    }
    case 'backstop.allocated': {
      const amount = pNum(p, 'amount')
      const shortfall = pNum(p, 'shortfall')
      return (
        <>
          {n()}&rsquo;s backstop was allocated {amount !== null ? <A minor={amount} currency={currency} /> : 'the gap'} to
          cover a {shortfall !== null ? <A minor={shortfall} currency={currency} /> : ''} shortfall.
        </>
      )
    }
    case 'backstop.absorbed': {
      const amount = pNum(p, 'amount')
      const txn = pStr(p, 'txn_id')
      return (
        <>
          {n()}&rsquo;s backstop absorbed{' '}
          {amount !== null ? <A minor={amount} currency={currency} /> : 'the shortfall'} — the group holds.
          {txn && (
            <>
              {' '}
              <M full={txn}>{short(txn)}</M>
            </>
          )}
        </>
      )
    }
    case 'backstop.failed':
      return (
        <>
          {n()}&rsquo;s backstop could not be charged
          {pStr(p, 'reason') ? <> — {pStr(p, 'reason')}</> : ''}.
        </>
      )
    case 'charge.attempted': {
      const amount = pNum(p, 'amount')
      const attempt = pNum(p, 'attempt')
      const ref = pStr(p, 'reference')
      return (
        <>
          Attempt {attempt ?? 1} on {n()}&rsquo;s {sourceWord(pStr(p, 'source'))} for{' '}
          {amount !== null ? <A minor={amount} currency={currency} /> : 'their share'}.
          {ref && (
            <>
              {' '}
              Idempotency <M full={ref}>{short(ref)}</M>
            </>
          )}
        </>
      )
    }
    case 'charge.succeeded': {
      const amount = pNum(p, 'amount')
      const txn = pStr(p, 'txn_id')
      return (
        <>
          {n()}&rsquo;s {sourceWord(pStr(p, 'source'))} cleared{' '}
          {amount !== null ? <A minor={amount} currency={currency} /> : ''} on attempt {pNum(p, 'attempt') ?? 1}.
          {txn && (
            <>
              {' '}
              <M full={txn}>{short(txn)}</M>
            </>
          )}
        </>
      )
    }
    case 'charge.failed': {
      const err = pStr(p, 'error') ?? 'UNKNOWN'
      return (
        <>
          {n()}&rsquo;s {sourceWord(pStr(p, 'source'))} was declined on attempt {pNum(p, 'attempt') ?? 1} —{' '}
          <M>{err}</M>
          {pStr(p, 'message') ? <>: {pStr(p, 'message')}</> : null}
        </>
      )
    }
    case 'charge.unknown':
      return (
        <>
          Attempt {pNum(p, 'attempt') ?? 1} on {n()}&rsquo;s {sourceWord(pStr(p, 'source'))} came back unknown
          {pStr(p, 'message') ? <> — {pStr(p, 'message')}</> : null}. It is treated as maybe-charged until settlement
          says otherwise, and never retried blind.
        </>
      )
    case 'charge.settlement_pending': {
      const txn = pStr(p, 'txn_id')
      return (
        <>
          Settlement is still pending{txn ? ' for ' : ''}
          {txn && <M full={txn}>{short(txn)}</M>}. The receipt waits for the network, not the other way round.
        </>
      )
    }
    case 'group.decision': {
      const plan = pArr(p, 'plan')
      return (
        <>
          Decision: {pStr(p, 'narrative') ?? 'the policy resolved'}
          {plan.length > 0 && (
            <>
              {' '}
              — {plan.length} {plan.length === 1 ? 'charge' : 'charges'} planned.
            </>
          )}
        </>
      )
    }
    case 'group.committing':
      return <>Point of no return — the group is committing. Cancel is off the table from here.</>
    case 'group.committed':
      return <>Committed. Every planned share cleared on its own capped credential.</>
    case 'group.partial':
      return <>Partially committed — some shares cleared, some did not. Only what cleared was charged.</>
    case 'group.aborted':
      return <>Aborted{pStr(p, 'reason') ? <> — {pStr(p, 'reason')}</> : ''}. Nothing was charged, to anyone.</>
    case 'group.expired':
      return <>Expired{pStr(p, 'reason') ? <> — {pStr(p, 'reason')}</> : ''}. Nothing was charged.</>
    case 'group.deadline': {
      const at = pStr(p, 'at')
      return <>Deadline reached{at ? <> at {clockTime(at)}</> : ''}. The policy decides with what it has.</>
    }
    case 'group.halted':
      return <>Halted before the next charge. What already cleared stays cleared; nothing new is attempted.</>
    case 'auction.opened': {
      const items = pArr(p, 'items')
      const closes = pStr(p, 'closes_at')
      return (
        <>
          Sealed bidding opened on {items.length} contested {items.length === 1 ? 'item' : 'items'}
          {closes && <> — bids close at {clockTime(closes)}</>}. Nobody sees anyone else&rsquo;s number.
        </>
      )
    }
    case 'auction.bid':
      return (
        <>
          {n()} placed a sealed bid on <M>{pStr(p, 'sku') ?? 'an item'}</M>. The amount stays hidden until reveal.
        </>
      )
    case 'auction.reveal': {
      const ranking = pArr(p, 'ranking')
      const won = ranking.filter((r) => r.won === true).map((r) => pStr(r, 'name') ?? 'a member')
      const slots = pNum(p, 'slots') ?? 1
      return (
        <>
          <b>{pStr(p, 'item') ?? 'Item'}</b> revealed — {slots} {slots === 1 ? 'slot' : 'slots'},{' '}
          {ranking.length} {ranking.length === 1 ? 'bid' : 'bids'}.{' '}
          {won.length > 0 ? <>{won.join(', ')} took it.</> : <>Nobody took it.</>} Bids allocate slots; the price
          never moves.
        </>
      )
    }
    case 'auction.lost':
      return (
        <>
          {n()} lost <M>{pStr(p, 'sku') ?? 'the item'}</M> and owes nothing for it.
        </>
      )
    case 'auction.closed': {
      const h = pStr(p, 'new_cart_hash')
      return (
        <>
          Bidding closed and the cart was re-hashed
          {h && (
            <>
              {' '}
              to <M full={h}>{short(h, 10)}</M>
            </>
          )}
          .
        </>
      )
    }
    case 'cart.adjusted': {
      const oldH = pStr(p, 'old_hash')
      const newH = pStr(p, 'new_hash')
      return (
        <>
          Cart adjusted — {pStr(p, 'reason') ?? 'the contents changed'}.
          {oldH && newH && (
            <>
              {' '}
              <M full={oldH}>{short(oldH, 6)}</M> → <M full={newH}>{short(newH, 6)}</M>
            </>
          )}
        </>
      )
    }
    case 'fx.snapshot': {
      const base = pStr(p, 'base') ?? currency
      const rates = Object.keys(pRates(p, 'rates')).length
      return (
        <>
          FX snapshot pinned against <M>{base}</M>
          {rates > 0 && <> across {rates} currencies</>}, so nobody&rsquo;s share drifts mid-flight.
        </>
      )
    }
    case 'receipt.issued': {
      const head = pStr(p, 'chain_head')
      return (
        <>
          Signed receipt issued.
          {head && (
            <>
              {' '}
              Chain head <M full={head}>{short(head, 10)}</M>
            </>
          )}
        </>
      )
    }
    default:
      return <>{humanise(e.type)}.</>
  }
}

/** Any type the engine adds later still reads as English, never as a payload dump. */
function humanise(type: string): string {
  const words = type.replace(/[._]/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}
