'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { useSession } from '@/components/session'

interface Note {
  id: string
  kind: string
  title: string
  body: string | null
  url: string | null
  created_at: string
  unread: boolean
}

/**
 * The in-app inbox that already existed on the engine — friend requests and
 * later protocol events land here even when browser push is off.
 */
export function InboxBell() {
  const { user } = useSession()
  const [open, setOpen] = useState(false)
  const [notes, setNotes] = useState<Note[]>([])
  const [unread, setUnread] = useState(0)

  const load = useCallback(async () => {
    if (!user) return
    try {
      const res = await api.get<{ notifications: Note[]; unread: number }>('/v1/notify/inbox?limit=20')
      setNotes(res.notifications ?? [])
      setUnread(res.unread ?? 0)
    } catch {
      // Bell stays quiet rather than erroring the shell.
    }
  }, [user])

  useEffect(() => {
    void load()
    const id = setInterval(() => void load(), 30_000)
    return () => clearInterval(id)
  }, [load])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!user) return null

  const markAll = async () => {
    try {
      await api.post('/v1/notify/read-all')
      setUnread(0)
      setNotes((prev) => prev.map((n) => ({ ...n, unread: false })))
    } catch {
      /* ignore */
    }
  }

  const openNote = async (n: Note) => {
    if (n.unread) {
      try {
        await api.post(`/v1/notify/read/${n.id}`)
        setUnread((u) => Math.max(0, u - 1))
        setNotes((prev) => prev.map((x) => (x.id === n.id ? { ...x, unread: false } : x)))
      } catch {
        /* ignore */
      }
    }
    setOpen(false)
  }

  return (
    <div className="inbox-bell">
      <button
        type="button"
        className="inbox-bell-btn"
        aria-label={unread ? `${unread} unread notifications` : 'Notifications'}
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v)
          if (!open) void load()
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M6 9a6 6 0 0 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9Z"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
          <path d="M10 20a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
        {unread > 0 && <span className="inbox-bell-dot">{unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && (
        <>
          <button type="button" className="inbox-bell-scrim" aria-label="Close" onClick={() => setOpen(false)} />
          <div className="inbox-panel" role="dialog" aria-label="Notifications">
            <div className="inbox-panel-head">
              <b>Inbox</b>
              {unread > 0 && (
                <button type="button" className="text-button tiny" onClick={() => void markAll()}>
                  Mark all read
                </button>
              )}
            </div>
            {notes.length === 0 ? (
              <p className="small muted" style={{ margin: 0, padding: '14px 16px' }}>
                Nothing yet. Friend requests and group updates land here.
              </p>
            ) : (
              <ul className="inbox-list">
                {notes.map((n) => (
                  <li key={n.id} className={n.unread ? 'is-unread' : undefined}>
                    {n.url ? (
                      <Link href={n.url} onClick={() => void openNote(n)}>
                        <span className="inbox-title">{n.title}</span>
                        {n.body && <span className="inbox-body">{n.body}</span>}
                        <span className="inbox-when tiny faint">{relative(n.created_at)}</span>
                      </Link>
                    ) : (
                      <button type="button" onClick={() => void openNote(n)}>
                        <span className="inbox-title">{n.title}</span>
                        {n.body && <span className="inbox-body">{n.body}</span>}
                        <span className="inbox-when tiny faint">{relative(n.created_at)}</span>
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="inbox-panel-foot">
              <Link href="/app/people" className="tiny" onClick={() => setOpen(false)}>
                People
              </Link>
              <Link href="/app/settings" className="tiny" onClick={() => setOpen(false)}>
                Push settings
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function relative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 60_000) return 'just now'
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`
  return `${Math.floor(ms / 86_400_000)}d`
}
