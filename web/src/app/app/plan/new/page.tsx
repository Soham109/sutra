'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Shell } from '@/components/shell'
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
  }
  extractor: 'openai' | 'deterministic'
  uncertainties: string[]
  plan?: PlanView
}

function NewPlanInner() {
  const router = useRouter()
  const params = useSearchParams()
  const [read, setRead] = useState<Understood | null>(null)
  const [people, setPeople] = useState<string[]>([])
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
        setPeople([...res.understood.people, ''])
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
      const named = people.map((p) => p.trim()).filter(Boolean)
      const res = await api.post<{ plan: PlanView }>('/v1/agent/plan', {
        text,
        participants: named.map((name) => ({ name })),
      })
      router.push(`/app/plans/${res.plan.plan_id}`)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  if (!text) {
    return (
      <div className="page">
        <ErrorNote>
          Nothing to plan. Start from the box on <a href="/app">Today</a>.
        </ErrorNote>
      </div>
    )
  }

  const s = read?.understood.slots

  return (
    <div className="page confirm-page">
      <header className="page-head">
        <span className="eyebrow">Check this is right</span>
        <h1>Here’s what we read.</h1>
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

          <section className="field">
            <span className="field-label">Who to ask</span>
            <div className="bill-people">
              {people.map((p, i) => (
                <input
                  key={i}
                  className="input"
                  value={p}
                  placeholder={`Person ${i + 1}`}
                  onChange={(e) => {
                    const next = [...people]
                    next[i] = e.target.value
                    if (i === people.length - 1 && e.target.value.trim()) next.push('')
                    setPeople(next)
                  }}
                />
              ))}
            </div>
            <span className="tiny faint">
              Each gets their own link. They answer on their phone with no account, and nothing they
              tap can charge them.
            </span>
          </section>

          <p className="confirm-ask">
            We’ll ask everyone for: <b>{read.understood.ask.join(', ')}</b> — then rank real places
            against the answers.
          </p>

          <button
            className="btn btn-primary btn-lg"
            disabled={busy || people.every((p) => !p.trim())}
            onClick={() => void create()}
          >
            {busy ? 'Setting it up…' : 'Ask the group'}
          </button>
        </>
      )}
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
    <Shell crumbs={<span className="here">New plan</span>}>
      <Suspense fallback={<div className="page"><Skeleton h={260} /></div>}>
        <NewPlanInner />
      </Suspense>
    </Shell>
  )
}
