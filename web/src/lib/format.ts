import type { GroupMember, MemberStatus, Policy } from './api'

const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'IDR', 'HUF', 'TWD'])
const SYMBOLS: Record<string, string> = {
  USD: '$', EUR: '€', GBP: '£', INR: '₹', JPY: '¥', AUD: 'A$', CAD: 'C$', SGD: 'S$', AED: 'AED ',
}

export function money(minor: number, currency = 'USD'): string {
  const div = ZERO_DECIMAL.has(currency) ? 1 : 100
  const sym = SYMBOLS[currency] ?? `${currency} `
  const neg = minor < 0 ? '-' : ''
  const abs = Math.abs(minor)
  const value = (abs / div).toLocaleString('en-US', {
    minimumFractionDigits: div === 1 ? 0 : 2,
    maximumFractionDigits: div === 1 ? 0 : 2,
  })
  return `${neg}${sym}${value}`
}

/** Convert a decimal string a human typed into integer minor units. */
export function toMinor(input: string, currency = 'USD'): number {
  const div = ZERO_DECIMAL.has(currency) ? 1 : 100
  const n = Number(String(input).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? Math.round(n * div) : 0
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

/** Deterministic avatar colour so a person looks the same everywhere. */
export function accentFor(seed: string): string {
  const palette = ['#2E2AD8', '#B7410E', '#12734F', '#7A2E8E', '#0F6C8C', '#A4231F', '#8A6D0B', '#3E5C2A']
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0
  return palette[Math.abs(h) % palette.length]!
}

export function relativeTime(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now()
  const abs = Math.abs(ms)
  const mins = Math.round(abs / 60000)
  if (mins < 1) return ms < 0 ? 'just now' : 'in a moment'
  if (mins < 60) return ms < 0 ? `${mins}m ago` : `in ${mins}m`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return ms < 0 ? `${hrs}h ago` : `in ${hrs}h`
  const days = Math.round(hrs / 24)
  return ms < 0 ? `${days}d ago` : `in ${days}d`
}

export function countdown(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return 'deadline passed'
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m left`
  return `${m}:${String(s).padStart(2, '0')} left`
}

export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

// --- protocol vocabulary, rendered for humans -------------------------------

export const MEMBER_LABEL: Record<MemberStatus, string> = {
  invited: 'Not opened',
  viewed: 'Reading',
  awaiting_approval: 'Deciding',
  approved: 'Approved',
  declined: 'Declined',
  expired: 'Timed out',
  dropped: 'Dropped',
  charging: 'Charging',
  charged: 'Paid',
  // at_venue rail: they agreed their amount and pay the venue directly. Never
  // labelled "Paid" — no card was charged through us, and the copy must not
  // let a reader assume otherwise.
  settled: 'Owed at venue',
  failed: 'Failed',
}

export function memberTone(s: MemberStatus): 'ok' | 'bad' | 'warn' | 'brand' | 'plain' {
  if (s === 'charged' || s === 'settled') return 'ok'
  if (s === 'approved') return 'brand'
  if (s === 'charging') return 'brand'
  if (s === 'awaiting_approval' || s === 'viewed') return 'warn'
  if (s === 'declined' || s === 'failed' || s === 'dropped' || s === 'expired') return 'bad'
  return 'plain'
}

/** Render a policy as the expression it is — the mono treatment is the point. */
export function policyExpr(p: Policy): string {
  switch (p.type) {
    case 'all_of': return 'all_of'
    case 'quorum': return `quorum(${p.m})`
    case 'weighted': return `weighted(${p.threshold})`
    case 'veto': return `veto(${p.member}, ${policyExpr(p.inner)})`
    case 'required': return `required(${p.member}, ${policyExpr(p.inner)})`
    case 'deadline':
      return `deadline(${clockTime(p.at)}, ${policyExpr(p.primary)}, ${policyExpr(p.fallback)})`
  }
}

/** The same policy in a sentence, for people who do not read formulas. */
export function policySentence(p: Policy): string {
  switch (p.type) {
    case 'all_of': return 'Everyone approves, or nobody pays'
    case 'quorum': return `Any ${p.m} approvals commit the group`
    case 'weighted': return `Approvals worth ${p.threshold} commit the group`
    case 'veto': return `${policySentence(p.inner)} — but ${p.member} can stop it`
    case 'required': return `${policySentence(p.inner)}, and ${p.member} must be one of them`
    case 'deadline':
      return `${policySentence(p.primary)} until ${clockTime(p.at)}, then ${policySentence(p.fallback).toLowerCase()}`
  }
}

export function progressOf(members: GroupMember[]): { done: number; total: number } {
  const payers = members.filter((m) => m.role !== 'observer')
  const done = payers.filter((m) =>
    ['approved', 'charging', 'charged', 'settled'].includes(m.status),
  ).length
  return { done, total: payers.length }
}
