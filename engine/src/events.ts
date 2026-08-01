import { createHmac } from 'node:crypto'
import type { Db } from './db.js'
import type { EventRow } from './types.js'

type Listener = (event: EventRow) => void

/**
 * Append-only event log + fan-out. Every state change flows through emit():
 * one write to the log, then SSE broadcast and webhook delivery. The log is
 * what the board renders, what replay scrubs, and what crash recovery reads.
 */
export class EventHub {
  private readonly listeners = new Map<string, Set<Listener>>()

  constructor(
    private readonly db: Db,
    private readonly webhookSecret: string,
  ) {}

  emit(groupId: string, memberId: string | null, type: string, payload: unknown = {}): EventRow {
    const event = this.db.appendEvent(groupId, memberId, type, payload)
    const subs = this.listeners.get(groupId)
    if (subs) for (const fn of subs) fn(event)
    this.dispatchWebhook(groupId, event)
    return event
  }

  subscribe(groupId: string, fn: Listener): () => void {
    let subs = this.listeners.get(groupId)
    if (!subs) {
      subs = new Set()
      this.listeners.set(groupId, subs)
    }
    subs.add(fn)
    return () => {
      subs.delete(fn)
      if (subs.size === 0) this.listeners.delete(groupId)
    }
  }

  private dispatchWebhook(groupId: string, event: EventRow): void {
    const group = this.db.getGroup(groupId)
    if (!group?.webhook_url) return
    if (!WEBHOOK_EVENT_TYPES.has(event.type)) return
    const body = JSON.stringify({
      seq: event.seq,
      group_id: event.group_id,
      member_id: event.member_id,
      type: event.type,
      payload: JSON.parse(event.payload_json),
      created_at: event.created_at,
    })
    const signature = createHmac('sha256', this.webhookSecret).update(body).digest('hex')
    // Fire and forget: webhook loss never blocks the protocol; the event log
    // remains the source of truth and subscribers can re-read via the API.
    fetch(group.webhook_url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-gmp-signature': signature },
      body,
    }).catch(() => undefined)
  }
}

const WEBHOOK_EVENT_TYPES = new Set([
  'group.committed',
  'group.aborted',
  'group.partial',
  'group.expired',
  'member.approved',
  'member.declined',
  'member.charged',
  'member.failed',
  'backstop.absorbed',
])
