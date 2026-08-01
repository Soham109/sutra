'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, api, type ChatMessage } from '@/lib/api'

// The thread on a plan or a group. Deliberately the same shape as
// useGroupStream: an initial GET for history, then the scope's OWN existing
// SSE endpoint tailed for anything that lands after — a message is just
// another event type on a log that already streams, so there is no second
// transport to keep alive here.

export type ChatStream = 'connecting' | 'live' | 'retrying' | 'idle'

export interface Messages {
  messages: ChatMessage[]
  loading: boolean
  error: string | null
  stream: ChatStream
  sending: boolean
  send: (text: string) => Promise<void>
}

const MAX_BACKOFF = 8000

export function useMessages(scope: 'plan' | 'group', id: string): Messages {
  const base = scope === 'plan' ? `/v1/plans/${encodeURIComponent(id)}` : `/v1/groups/${encodeURIComponent(id)}`
  const eventName = scope === 'plan' ? 'plan' : 'gmp'

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [stream, setStream] = useState<ChatStream>('idle')
  const [sending, setSending] = useState(false)

  const cursor = useRef(0)
  const seen = useRef(new Set<number>())
  const alive = useRef(true)

  const load = useCallback(async () => {
    if (!id) return
    try {
      const res = await api.get<{ messages: ChatMessage[] }>(`${base}/messages`)
      if (!alive.current) return
      setMessages(res.messages)
      seen.current = new Set(res.messages.map((m) => m.seq))
      cursor.current = res.messages.at(-1)?.seq ?? cursor.current
      setError(null)
    } catch (err) {
      if (!alive.current) return
      // A 403 here means "you're not part of this" rather than a real fault
      // — the thread simply does not render for that viewer.
      if (err instanceof ApiError && (err.status === 403 || err.status === 401)) {
        setMessages([])
      } else {
        setError(err instanceof Error ? err.message : 'Could not load the thread.')
      }
    } finally {
      if (alive.current) setLoading(false)
    }
  }, [base, id])

  useEffect(() => {
    if (!id) return
    alive.current = true
    cursor.current = 0
    seen.current = new Set<number>()
    setMessages([])
    setLoading(true)
    setError(null)

    void load()

    let source: EventSource | null = null
    let retry: ReturnType<typeof setTimeout> | null = null
    let attempt = 0
    let stopped = false

    const onMessage = (ev: Event) => {
      const msg = ev as MessageEvent<string>
      let parsed: { seq: number; type: string; payload: Record<string, unknown>; at: string }
      try {
        parsed = JSON.parse(msg.data)
      } catch {
        return
      }
      if (typeof parsed?.seq !== 'number') return
      if (parsed.seq > cursor.current) cursor.current = parsed.seq
      if (parsed.type !== 'message.posted' || seen.current.has(parsed.seq)) return
      seen.current.add(parsed.seq)
      const p = parsed.payload as Omit<ChatMessage, 'seq' | 'created_at'>
      setMessages((prev) => [...prev, { ...p, seq: parsed.seq, created_at: parsed.at }].sort((a, b) => a.seq - b.seq))
    }

    const connect = () => {
      if (stopped) return
      setStream(attempt === 0 ? 'connecting' : 'retrying')
      const es = new EventSource(`/api${base}/events?after=${cursor.current}`)
      source = es
      es.addEventListener('open', () => {
        attempt = 0
        if (!stopped) setStream('live')
      })
      es.addEventListener(eventName, onMessage)
      es.addEventListener('error', () => {
        es.close()
        if (source === es) source = null
        if (stopped) return
        setStream('retrying')
        attempt += 1
        retry = setTimeout(connect, Math.min(MAX_BACKOFF, 500 * 2 ** (attempt - 1)))
      })
    }
    connect()

    return () => {
      stopped = true
      alive.current = false
      if (retry) clearTimeout(retry)
      source?.close()
      source = null
    }
  }, [base, id, eventName, load])

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      setSending(true)
      setError(null)
      try {
        await api.post(`${base}/messages`, { text: trimmed })
        // The SSE tail delivers this same line moments later; loading it now
        // too just means the sender sees it appear instantly rather than
        // waiting on their own round trip twice.
        await load()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'That message did not send.')
        throw err
      } finally {
        setSending(false)
      }
    },
    [base, load],
  )

  return { messages, loading, error, stream, sending, send }
}
