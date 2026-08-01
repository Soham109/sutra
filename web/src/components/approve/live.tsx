'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type GmpEvent, type Group } from '@/lib/api'
import { humanError, type MemberView } from './model'

export type MemberAction = 'decline' | 'hold' | 'resume'

export interface Live {
  view: MemberView | null
  group: Group | null
  events: GmpEvent[]
  loading: boolean
  error: string | null
  connected: boolean
  busy: MemberAction | 'bid' | null
  actionError: string | null
  clearActionError: () => void
  refresh: () => Promise<void>
  run: (action: MemberAction) => Promise<void>
  bid: (sku: string, amount: number) => Promise<void>
}

/**
 * The member's live view of their own share.
 *
 * Two rules make the demo work: (1) the view is fetched with POST /open, never
 * GET, because opening lazily mints the Prava mandate session — after a requote
 * that is the only way the fresh approval_url appears; (2) every engine event
 * re-pulls, so four phones flip to the same state inside one animation frame of
 * each other.
 */
export function useMemberLive(memberId: string): Live {
  const [view, setView] = useState<MemberView | null>(null)
  const [group, setGroup] = useState<Group | null>(null)
  const [events, setEvents] = useState<GmpEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [busy, setBusy] = useState<MemberAction | 'bid' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const alive = useRef(true)
  const inflight = useRef(false)
  const queued = useRef(false)

  const pull = useCallback(async (): Promise<void> => {
    if (inflight.current) {
      queued.current = true
      return
    }
    inflight.current = true
    try {
      const v = await api.post<MemberView>(`/v1/members/${memberId}/open`)
      if (!alive.current) return
      setView(v)
      setError(null)
      const g = await api.get<Group>(`/v1/groups/${v.group_id}`)
      if (!alive.current) return
      setGroup(g)
    } catch (e) {
      if (alive.current) setError(humanError(e))
    } finally {
      inflight.current = false
      if (alive.current) setLoading(false)
      if (queued.current && alive.current) {
        queued.current = false
        void pull()
      }
    }
  }, [memberId])

  useEffect(() => {
    alive.current = true
    void pull()
    return () => {
      alive.current = false
    }
  }, [pull])

  // --- the synchronised flip ------------------------------------------------
  const groupId = view?.group_id ?? null
  useEffect(() => {
    if (!groupId) return
    let es: EventSource | null = null
    let retry: ReturnType<typeof setTimeout> | null = null
    let debounce: ReturnType<typeof setTimeout> | null = null
    let stopped = false

    const connect = () => {
      if (stopped) return
      es = new EventSource(`/api/v1/groups/${groupId}/events?after=0`)
      es.onopen = () => setConnected(true)
      es.addEventListener('gmp', (raw) => {
        const ev = JSON.parse((raw as MessageEvent<string>).data) as GmpEvent
        setEvents((prev) =>
          prev.some((p) => p.seq === ev.seq) ? prev : [...prev, ev].sort((a, b) => a.seq - b.seq),
        )
        // Coalesce the burst the engine replays on connect, but stay well
        // inside the 300ms the demo depends on.
        if (debounce) clearTimeout(debounce)
        debounce = setTimeout(() => void pull(), 60)
      })
      es.onerror = () => {
        setConnected(false)
        es?.close()
        if (!stopped) retry = setTimeout(connect, 1500)
      }
    }
    connect()

    return () => {
      stopped = true
      setConnected(false)
      es?.close()
      if (retry) clearTimeout(retry)
      if (debounce) clearTimeout(debounce)
    }
  }, [groupId, pull])

  const run = useCallback(
    async (action: MemberAction) => {
      setBusy(action)
      setActionError(null)
      try {
        const v = await api.post<MemberView>(`/v1/members/${memberId}/${action}`)
        if (!alive.current) return
        setView(v)
        void pull()
      } catch (e) {
        if (alive.current) setActionError(humanError(e))
      } finally {
        if (alive.current) setBusy(null)
      }
    },
    [memberId, pull],
  )

  const bid = useCallback(
    async (sku: string, amount: number) => {
      setBusy('bid')
      setActionError(null)
      try {
        const v = await api.post<MemberView>(`/v1/members/${memberId}/bid`, { sku, amount })
        if (alive.current) setView(v)
      } catch (e) {
        if (alive.current) setActionError(humanError(e))
      } finally {
        if (alive.current) setBusy(null)
      }
    },
    [memberId],
  )

  const clearActionError = useCallback(() => setActionError(null), [])

  return {
    view,
    group,
    events,
    loading,
    error,
    connected,
    busy,
    actionError,
    clearActionError,
    refresh: pull,
    run,
    bid,
  }
}
