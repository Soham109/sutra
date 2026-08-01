'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Shell } from '@/components/shell'
import { PeoplePicker, type PickedPerson } from '@/components/people/PeoplePicker'
import { ErrorNote, Skeleton } from '@/components/ui'
import { money } from '@/lib/format'
import { api } from '@/lib/api'
import type { PlanView } from '@/components/plan/model'

// The confirm step between a sentence and a plan.
//
// The extractor proposes; the human disposes. Everything it read is shown as
// an editable card with its uncertainties stated plainly, because a system
// that silently acts on its own reading of your sentence is one wrong parse
// away from inviting the wrong people to the wrong city.

interface Understood {
  understood: {
    title: string
    kind: string
    slots: {
      category?: string
      currency?: string
      budget_ceiling_minor?: number
      when?: { hint?: string; earliest?: string }
      where?: { label: string; country_code?: string } | null
      party_size?: number
    }
    people: string[]
    ask: string[]
    /** the sentence said "alone" — there is nobody to poll */
    solo?: boolean
  }
  extractor: 'openai' | 'deterministic'
  uncertainties: string[]
  plan?: PlanView
}

function NewPlanInner() {
  const router = useRouter()
  const params = useSearchParams()
  const [read, setRead] = useState<Understood | null>(null)
  const [people, setPeople] = useState<PickedPerson[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [text, setText] = useState('')
  const started = useRef(false)

  // The URL carries a truncated copy so a shared or refreshed link still
  // works; session storage carries the whole sentence, which is what we
  // actually want to read. Longest wins.
  useEffect(() => {
    const fromUrl = params.get('q') ?? ''
    const stashed = sessionStorage.getItem('sutra:intent') ?? ''
    setText(stashed.length > fromUrl.length ? stashed : fromUrl)
  }, [params])

  useEffect(() => {
    if (started.current || !text) return
    started.current = true
    ;(async () => {
      try {
        const res = await api.post<Understood>('/v1/agent/plan', { text, dry_run: true })
        setRead(res)
        // Names the extractor read out of the sentence arrive with no
        // account attached — same as anyone typed in by hand. The picker
        // below still offers to link them if one matches a friend.
        setPeople(res.understood.people.map((name) => ({ key: `n:${name.trim().toLowerCase()}`, name })))
      } catch (e) {
        setError((e as Error).message)
      }
    })()
  }, [text])

  const create = async () => {
    if (!read) return
    setBusy(true)
    setError('')
    try {
      // A friend picked here carries their real account through, so they can
      // be notified and the plan shows up in their own dashboard — not just
      // a name typed into a box (see MemberInputSchema.user_id).
      const res = await api.post<{ plan: PlanView }>('/v1/agent/plan', {
        text,
        participants: people.map((p) => ({ name: p.name, user_id: p.userId })),
      })
      router.push(`/app/plans/${res.plan.plan_id}`)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  // Arriving with nothing is the NORMAL case — this is where every "Plan with
  // Sutra bot" button on the site points. Ask for the sentence rather than
  // treating an empty query as an error, which read as a broken app.
  if (!text) return <AskSutraBot onAsk={(t) => setText(t)} />

  const s = read?.understood.slots

  return (
    <div className="page confirm-page">
      <header className="page-head">
        <span className="eyebrow">Sutra bot · check this is right</span>
        <h1>Here’s what I read.</h1>
        <p className="muted">“{text}”</p>
      </header>

      {error && <ErrorNote>{error}</ErrorNote>}

      {!read ? (
        <Skeleton h={260} />
      ) : (
        <>
          <div className="confirm-grid">
            <Fact label="What" value={s?.category ?? read.understood.kind} />
            <Fact label="Where" value={s?.where?.label ?? 'we’ll ask everyone'} />
            <Fact label="When" value={s?.when?.hint ?? 'we’ll ask everyone'} />
            <Fact
              label="Budget each"
              value={
                s?.budget_ceiling_minor
                  ? money(s.budget_ceiling_minor, s.currency ?? 'USD')
                  : 'no limit given'
              }
            />
          </div>

          {read.uncertainties.length > 0 && (
            <ul className="confirm-notes">
              {read.uncertainties.map((u, i) => (
                <li key={i}>{u}</li>
              ))}
            </ul>
          )}

          {/* "Dinner alone in some good cafe" is a complete instruction. Asking
              who else is coming — and disabling the button until you name
              somebody — is the app arguing with a sentence it just read
              correctly. Adding people stays possible; it is no longer required.
              And when it is needed, it offers real friends instead of a blank
              box labelled "Person 2". */}
          <section className="field">
            {read.understood.solo && people.length === 0 ? (
              <p className="solo-note">
                You said this one is just for you, so there is nobody to poll — I’ll go straight to
                finding places. Add someone below if you change your mind.
              </p>
            ) : null}
            <PeoplePicker value={people} onChange={setPeople} label={read.understood.solo ? 'Just you' : 'Who to ask'} />
            <span className="tiny faint">
              Each gets their own link. Friends with accounts see the plan on their dashboard; anyone
              added by name just answers on their phone with no account — and nothing anyone taps can
              charge them.
            </span>
          </section>

          <p className="confirm-ask">
            {read.understood.ask.length === 0 ? (
              <>Nothing to ask anybody — straight to real places near you.</>
            ) : (
              <>
                We’ll ask everyone for: <b>{read.understood.ask.join(', ')}</b> — then rank real
                places against the answers.
              </>
            )}
          </p>

          {/* Never dead. A solo plan needs nobody; a group plan with no names
              yet still creates the plan and gives you links to share. */}
          <button className="btn btn-primary btn-lg" disabled={busy} onClick={() => void create()}>
            {busy
              ? 'Setting it up…'
              : people.length > 0
                ? 'Ask the group'
                : read.understood.solo
                  ? 'Find me somewhere'
                  : 'Create it and get the links'}
          </button>
        </>
      )}
    </div>
  )
}

const EXAMPLES = [
  'Dinner Saturday with Arsh and Maya near Koramangala, under ₹800 each',
  'Somewhere to watch the match with the boys tonight',
  'Coffee tomorrow morning with Priya around Indiranagar',
]

/** The Sutra bot prompt. One box, some real examples, no jargon. */
function AskSutraBot({ onAsk }: { onAsk: (text: string) => void }) {
  const [value, setValue] = useState('')
  const go = (t: string) => {
    const trimmed = t.trim()
    if (!trimmed) return
    // Keep the sentence in the URL so a refresh or a shared link still works.
    sessionStorage.setItem('sutra:intent', trimmed)
    history.replaceState(null, '', `/app/plan/new?q=${encodeURIComponent(trimmed.slice(0, 300))}`)
    onAsk(trimmed)
  }

  return (
    <div className="page ask-page">
      <header className="page-head">
        <span className="eyebrow">Sutra bot</span>
        <h1>What are we doing?</h1>
        <p className="muted">
          Say it the way you’d say it to a friend. I’ll work out who you mean, roughly when, and
          what it should cost — then ask everyone else the awkward questions for you.
        </p>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          go(value)
        }}
        className="ask-box"
      >
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              go(value)
            }
          }}
          rows={3}
          autoFocus
          placeholder="Dinner Saturday with Arsh and Maya near Koramangala, under ₹800 each"
          aria-label="Describe what you want to plan"
        />
        <button className="btn btn-primary btn-lg" disabled={!value.trim()}>
          Plan it
        </button>
      </form>

      <div className="ask-examples">
        <span className="tiny faint">Try one:</span>
        {EXAMPLES.map((ex) => (
          <button key={ex} type="button" onClick={() => go(ex)}>
            {ex}
          </button>
        ))}
      </div>

      <p className="ask-alt tiny faint">
        Already know what you’re buying? <a href="/app/discover">Paste the link</a>. Bill already
        arrived? <a href="/app/bill">Split it</a>.
      </p>
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="confirm-fact">
      <span className="field-label">{label}</span>
      <span className="confirm-value">{value}</span>
    </div>
  )
}

export default function NewPlanPage() {
  return (
    <Shell crumbs={<span className="here">Sutra bot</span>}>
      <Suspense fallback={<div className="page"><Skeleton h={260} /></div>}>
        <NewPlanInner />
      </Suspense>
    </Shell>
  )
}
