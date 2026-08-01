'use client'

import type { GroupStatus } from '@/lib/api'
import { Badge } from '@/components/ui'
import type { Tone } from './narrate'

// The group's own state machine, labelled. Green and red mean exactly one
// thing here: money moved, or money did not.

const GROUP_LABEL: Record<GroupStatus, string> = {
  draft: 'Draft',
  collecting: 'Collecting',
  deciding: 'Deciding',
  committing: 'Charging',
  committed: 'Committed',
  partial: 'Partial',
  aborted: 'Aborted',
  expired: 'Expired',
}

const GROUP_TONE: Record<GroupStatus, Tone> = {
  draft: 'plain',
  collecting: 'brand',
  deciding: 'warn',
  committing: 'brand',
  committed: 'ok',
  partial: 'warn',
  aborted: 'bad',
  expired: 'bad',
}

export function groupLabel(s: GroupStatus): string {
  return GROUP_LABEL[s] ?? s
}

export function GroupBadge({ status, live }: { status: GroupStatus; live?: boolean }) {
  return (
    <Badge tone={GROUP_TONE[status] ?? 'plain'}>
      {live && <span className="dot dot-brand dot-live" />}
      {GROUP_LABEL[status] ?? status}
    </Badge>
  )
}

const ROLE_LABEL: Record<string, string> = {
  payer: 'Payer',
  sponsor: 'Sponsor',
  backstop: 'Backstop',
  observer: 'Observer',
}

export function RoleBadge({ role }: { role: string }) {
  return <Badge tone={role === 'backstop' ? 'brand' : 'plain'}>{ROLE_LABEL[role] ?? role}</Badge>
}

export const STRAGGLER_LABEL: Record<string, string> = {
  retry_once: 'Retry a straggler once, then decide',
  drop_and_continue: 'Drop a straggler and continue without them',
  halt_partial: 'Halt and settle only what already cleared',
}
