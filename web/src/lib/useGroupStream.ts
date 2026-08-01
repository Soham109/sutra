'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, api, type GmpEvent, type Group } from '@/lib/api'

// One live subscription to a group. The engine replays the whole log from
// ?after=<seq> on connect, so opening at 0 gives us the complete history —
// which is what makes replay, and any reconnect, free and lossless.

export type StreamState = 'connecting' | 'live' | 'retrying' | 'idle'

export interface GroupStream {
  group: Group | null
  events: GmpEvent[]
  loading: boolean
  error: string | null
  stream: StreamState
  refresh: () => Promise<void>
  applyGroup: (g: Group) => void
}

const MAX_BACKOFF = 8000

export function useGroupStream(id: string): GroupStream {
  const [group, setGroup] = useState<Group | null>(null)
  const [events, setEvents] = useState<GmpEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [stream, setStream] = useState<StreamState>('idle')

  const cursor = useRef(0)
  const seen = useRef(new Set<number>())
  const alive = useRef(true)
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    try {
      const g = await api.get<Group>(`/v1/groups/${encodeURIComponent(id)}`)
      if (!alive.current) return
      setGroup(g)
      setError(null)
    } catch (err) {
      if (!alive.current) return
      if (err instanceof ApiError && err.status === 404) {
        setError('That group does not exist any more, or the link was never meant for this account.')
      } else {
        setError(err instanceof Error ? err.message : 'Could not reach the engine.')
      }
    } finally {
      if (alive.current) setLoading(false)
    }
  }, [id])

  useEffect(() => {
    if (!id) return
    alive.current = true
    cursor.current = 0
    seen.current = new Set<number>()
    setEvents([])
    setGroup(null)
    setLoading(true)
    setError(null)

    void load()

    let source: EventSource | null = null
    let retry: ReturnType<typeof setTimeout> | null = null
    let attempt = 0
    let stopped = false

    // Coalesce refetches: a commit lands as a burst of events and we want one
    // authoritative view, fast enough that the flip still feels instant.
    const resync = () => {
      if (pending.current !== null) return
      pending.current = setTimeout(() => {
        pending.current = null
        void load()
      }, 120)
    }

    const onMessage = (ev: Event) => {
      const msg = ev as MessageEvent<string>
      let parsed: GmpEvent
      try {
        parsed = JSON.parse(msg.data) as GmpEvent
      } catch {
        return
      }
      if (typeof parsed?.seq !== 'number' || seen.current.has(parsed.seq)) return
      seen.current.add(parsed.seq)
      if (parsed.seq > cursor.current) cursor.current = parsed.seq
      setEvents((prev) => [...prev, parsed].sort((a, b) => a.seq - b.seq))
      resync()
    }

    const connect = () => {
      if (stopped) return
      setStream(attempt === 0 ? 'connecting' : 'retrying')
      const es = new EventSource(`/api/v1/groups/${encodeURIComponent(id)}/events?after=${cursor.current}`)
      source = es
      es.addEventListener('open', () => {
        attempt = 0
        if (!stopped) setStream('live')
      })
      // The engine names every frame 'gmp' and puts the protocol type inside.
      es.addEventListener('gmp', onMessage)
      es.addEventListener('error', () => {
        es.close()
        if (source === es) source = null
        if (stopped) return
        setStream('retrying')
        attempt += 1
        // Own the reconnect so we resume from our own cursor, not from zero.
        retry = setTimeout(connect, Math.min(MAX_BACKOFF, 500 * 2 ** (attempt - 1)))
      })
    }

    connect()

    return () => {
      stopped = true
      alive.current = false
      if (retry) clearTimeout(retry)
      if (pending.current !== null) {
        clearTimeout(pending.current)
        pending.current = null
      }
      source?.close()
      source = null
    }
  }, [id, load])

  const applyGroup = useCallback((g: Group) => setGroup(g), [])

  return { group, events, loading, error, stream, refresh: load, applyGroup }
}
