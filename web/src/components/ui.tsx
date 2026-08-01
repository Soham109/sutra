'use client'

import { useEffect, useRef, useState } from 'react'
import type { GroupMember, MemberStatus, Policy } from '@/lib/api'
import {
  MEMBER_LABEL, accentFor, countdown, initials, memberTone, money, policyExpr, policySentence,
} from '@/lib/format'

// Shared primitives. Deliberately small and unstyled-by-props: the look lives
// in globals.css so every surface stays in one visual system.

export function Avatar({ name, size = 'md', color }: { name: string; size?: 'sm' | 'md' | 'lg'; color?: string }) {
  const cls = size === 'sm' ? 'avatar avatar-sm' : size === 'lg' ? 'avatar avatar-lg' : 'avatar'
  return (
    <div className={cls} style={{ background: color ?? accentFor(name) }} title={name} aria-hidden>
      {initials(name)}
    </div>
  )
}

export function Badge({
  tone = 'plain',
  children,
}: {
  tone?: 'ok' | 'bad' | 'warn' | 'brand' | 'plain'
  children: React.ReactNode
}) {
  return <span className={tone === 'plain' ? 'badge' : `badge badge-${tone}`}>{children}</span>
}

export function StatusBadge({ status }: { status: MemberStatus }) {
  return <Badge tone={memberTone(status)}>{MEMBER_LABEL[status]}</Badge>
}

export function Money({ minor, currency = 'USD', size }: { minor: number; currency?: string; size?: 'lg' | 'xl' }) {
  const cls = size === 'xl' ? 'amount amount-xl' : size === 'lg' ? 'amount amount-lg' : 'amount'
  return <span className={cls}>{money(minor, currency)}</span>
}

/** The policy, shown as formula and sentence together — neither alone is enough. */
export function PolicyChip({ policy, sentence = true }: { policy: Policy; sentence?: boolean }) {
  return (
    <div className="col" style={{ gap: 6, alignItems: 'flex-start' }}>
      <code className="policy-expr">{policyExpr(policy)}</code>
      {sentence && <span className="small muted">{policySentence(policy)}</span>}
    </div>
  )
}

/**
 * THE CONSENT THREAD. One node per member; the filled segment is the fraction
 * of the group whose own mandate is live. The thread draws itself out of
 * consent, which is the whole product in one control.
 */
export function ConsentThread({
  members,
  currency = 'USD',
  showAmounts = true,
  anonymiseDeclines = false,
}: {
  members: GroupMember[]
  currency?: string
  showAmounts?: boolean
  anonymiseDeclines?: boolean
}) {
  const payers = members.filter((m) => m.role !== 'observer')
  if (payers.length === 0) return null

  const settled = payers.filter((m) =>
    ['approved', 'charging', 'charged', 'settled'].includes(m.status),
  ).length
  // Fill reaches the centre of the last settled node.
  const step = payers.length > 1 ? 100 / (payers.length - 1) : 100
  const pct = settled === 0 ? 0 : Math.min(100, (settled - 1) * step + (settled === payers.length ? 0 : 0))

  return (
    <div className="thread" role="list" aria-label="Consent thread">
      <div className="thread-fill" style={{ width: `calc((100% - 44px) * ${pct / 100})` }} />
      {payers.map((m) => {
        const hidden = anonymiseDeclines && ['declined', 'dropped'].includes(m.status)
        const label = hidden ? 'A member' : m.name
        return (
          <div className="thread-node" data-state={m.status} key={m.member_id} role="listitem">
            <div className="thread-ring">
              <Avatar name={label} color={hidden ? 'var(--ink-3)' : undefined} />
            </div>
            <div className="thread-name">{label}</div>
            {showAmounts && (
              <div className="thread-amount amount muted">
                {money(m.status === 'charged' ? m.charged_amount || m.share_amount : m.share_amount, currency)}
              </div>
            )}
            <StatusBadge status={m.status} />
            {m.backstop_absorbed > 0 && (
              <span className="tiny" style={{ color: 'var(--ok)' }}>
                +{money(m.backstop_absorbed, currency)} absorbed
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function Countdown({ to }: { to: string }) {
  const [text, setText] = useState(() => countdown(to))
  useEffect(() => {
    const id = setInterval(() => setText(countdown(to)), 1000)
    return () => clearInterval(id)
  }, [to])
  return <span className="small mono muted">{text}</span>
}

export function Guardrail({
  merchant,
  cap,
  currency = 'USD',
}: {
  merchant: string
  cap: number
  currency?: string
}) {
  return (
    <p className="guardrail">
      Locked to <b>{merchant}</b>. Capped at <b>{money(cap, currency)}</b>. Single use, expires with the group.
      These limits are enforced at the card network — not by this app.
    </p>
  )
}

export function Empty({
  title,
  children,
  action,
}: {
  title: string
  children?: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  )
}

export function Skeleton({ h = 16, w = '100%' }: { h?: number; w?: string | number }) {
  return <div className="skeleton" style={{ height: h, width: w }} />
}

export function Modal({
  title,
  onClose,
  children,
  footer,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    ref.current?.querySelector<HTMLElement>('input,button,textarea,select')?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" ref={ref} role="dialog" aria-modal="true" aria-label={title}>
        <div className="row-between" style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)' }}>
          <h3>{title}</h3>
          <button className="btn btn-ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div style={{ padding: 18 }}>{children}</div>
        {footer && (
          <div className="row" style={{ padding: 14, borderTop: '1px solid var(--line)', justifyContent: 'flex-end' }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

/** Inline error that says what happened and what to do — never a bare code. */
export function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="note note-bad" role="alert">
      <span aria-hidden>⚠</span>
      <span>{children}</span>
    </div>
  )
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="row small muted" style={{ gap: 8 }}>
      <span className="dot dot-brand dot-live" />
      {label ?? 'Working…'}
    </span>
  )
}
