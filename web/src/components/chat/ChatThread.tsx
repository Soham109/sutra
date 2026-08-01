'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Avatar, ErrorNote, Skeleton } from '@/components/ui'
import { useSession } from '@/components/session'
import { relativeTime } from '@/lib/format'
import { useMessages, type ChatStream } from '@/lib/useMessages'
import type { ChatMessage } from '@/lib/api'

// The thread: people in a plan or a group, talking, with @sutra one tag away.
// Deliberately a log, not a bubble chart — the rest of this product renders
// truth as rows (EventLog, waiting-list, settled-list), and a chat message is
// just one more fact with a name and a time on it.

const HINT: Record<'plan' | 'group', string> = {
  plan: "who's in, the best time, or the options — or say refresh to search again",
  group: "who's approved or what's in the cart",
}

export function ChatThread({ scope, id }: { scope: 'plan' | 'group'; id: string }) {
  const { user } = useSession()
  const { messages, loading, error, stream, sending, send } = useMessages(scope, id)
  const [text, setText] = useState('')
  const [mentionOpen, setMentionOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length])

  // True only right after "@" and only while every character typed since
  // still agrees with "sutra" — the moment it stops matching, the suggestion
  // disappears rather than dangling on a name that can never complete.
  const mentionActive = useMemo(() => {
    const caret = inputRef.current?.selectionStart ?? text.length
    const m = /(^|\s)@([a-z]*)$/i.exec(text.slice(0, caret))
    return !!m && 'sutra'.startsWith((m[2] ?? '').toLowerCase())
  }, [text])

  useEffect(() => setMentionOpen(mentionActive), [mentionActive])

  const insertMention = () => {
    const caret = inputRef.current?.selectionStart ?? text.length
    const head = text.slice(0, caret).replace(/@([a-z]*)$/i, '@sutra ')
    const next = head + text.slice(caret)
    setText(next)
    setMentionOpen(false)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(head.length, head.length)
    })
  }

  const submit = async () => {
    const value = text.trim()
    if (!value || sending) return
    setText('')
    setMentionOpen(false)
    try {
      await send(value)
    } catch {
      setText(value) // failed sends give the draft back rather than eating it
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionOpen && (e.key === 'Tab' || e.key === 'Enter')) {
      e.preventDefault()
      insertMention()
      return
    }
    if (e.key === 'Escape' && mentionOpen) {
      e.preventDefault()
      setMentionOpen(false)
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit()
    }
  }

  if (!user) {
    return (
      <div className="card card-pad chat-thread">
        <span className="eyebrow">Thread</span>
        <p className="small muted" style={{ marginTop: 8 }}>
          Sign in to read and join this thread.
        </p>
      </div>
    )
  }

  return (
    <div className="card chat-thread">
      <div className="chat-head-bar">
        <span className="eyebrow">Thread</span>
        <StreamDot stream={stream} />
      </div>

      <div className="chat-scroll" ref={scrollRef}>
        {loading ? (
          <div className="col" style={{ gap: 10, padding: '2px' }}>
            <Skeleton h={38} />
            <Skeleton h={38} w="78%" />
          </div>
        ) : messages.length === 0 ? (
          <div className="chat-empty">
            No messages yet. Say hello, or tag <b className="mono">@sutra</b> — ask {HINT[scope]}.
          </div>
        ) : (
          messages.map((m) => <ChatRow key={m.message_id} m={m} mine={!!user && m.author_user_id === user.id} />)
        )}
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="chat-composer">
        {mentionOpen && (
          <div className="chat-mention-menu" role="listbox">
            <button
              type="button"
              className="chat-mention-item"
              onMouseDown={(e) => e.preventDefault()}
              onClick={insertMention}
              role="option"
              aria-selected="true"
            >
              <span className="chat-mention-mark" aria-hidden>
                ✳
              </span>
              <span>
                sutra
                <small>Tab or Enter to tag the {scope === 'plan' ? 'plan' : 'group'} bot</small>
              </span>
            </button>
          </div>
        )}
        <div className="chat-input-row">
          <textarea
            ref={inputRef}
            className="input"
            placeholder={`Message the ${scope === 'plan' ? 'plan' : 'group'}… try @sutra`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            maxLength={2000}
          />
          <button className="btn btn-primary" onClick={() => void submit()} disabled={sending || !text.trim()}>
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ChatRow({ m, mine }: { m: ChatMessage; mine: boolean }) {
  const isBot = m.from === 'bot'
  return (
    <div className={isBot ? 'chat-row chat-row-bot' : 'chat-row'}>
      <Avatar name={m.author_name} size="sm" color={isBot ? 'var(--brand)' : undefined} />
      <div className="chat-bubble">
        <div className="chat-line-head">
          <span className={isBot ? 'chat-name is-bot' : 'chat-name'}>{m.author_name}</span>
          {mine && !isBot && <span className="tiny faint">you</span>}
          {isBot && m.used_rules && m.used_rules.length > 0 && (
            <span className="badge badge-brand" title={m.used_rules.join(', ')}>
              used your preferences
            </span>
          )}
          <span className="tiny faint chat-time">{relativeTime(m.created_at)}</span>
        </div>
        <div className="chat-text-wrap">
          <p className="chat-text">{m.text}</p>
        </div>
      </div>
    </div>
  )
}

function StreamDot({ stream }: { stream: ChatStream }) {
  if (stream === 'live') {
    return (
      <span className="row tiny faint chat-stream">
        <span className="dot dot-brand dot-live" /> live
      </span>
    )
  }
  if (stream === 'retrying') {
    return (
      <span className="row tiny faint chat-stream">
        <span className="dot dot-warn" /> reconnecting…
      </span>
    )
  }
  return (
    <span className="row tiny faint chat-stream">
      <span className="dot" /> connecting…
    </span>
  )
}
