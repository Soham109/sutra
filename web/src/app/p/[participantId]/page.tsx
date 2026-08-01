'use client'

import { use, useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { ErrorNote, Skeleton } from '@/components/ui'
import { AvailabilityPicker } from '@/components/plan/availability'
import { LocationPicker } from '@/components/plan/location'
import { BudgetPicker } from '@/components/plan/budget'
import type { ParticipantView, SignalPayload } from '@/components/plan/model'

// The page a friend opens from a link, on a phone, with no account.
//
// It asks one question at a time. Group coordination fails when the ask is a
// form; it works when it is a single tappable question you can answer in three
// seconds while walking. Nothing here can spend money — the payment approval
// is a separate page, behind the member's own passkey.

export default function ParticipantPage({
  params,
}: {
  params: Promise<{ participantId: string }>
}) {
  const { participantId } = use(params)
  const router = useRouter()
  const [view, setView] = useState<ParticipantView | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setView(await api.get<ParticipantView>(`/v1/participants/${participantId}`))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [participantId])

  useEffect(() => {
    void load()
    const id = setInterval(() => void load(), 6000)
    return () => clearInterval(id)
  }, [load])

  const send = async (payload: SignalPayload) => {
    setBusy(true)
    setError('')
    try {
      await api.post(`/v1/participants/${participantId}/signal`, payload)
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (error && !view) {
    return (
      <main className="answer">
        <ErrorNote>
          This link didn’t open — {error}. Ask whoever invited you to send it again.
        </ErrorNote>
      </main>
    )
  }

  if (!view) {
    return (
      <main className="answer">
        <Skeleton h={26} w="60%" />
        <div style={{ height: 18 }} />
        <Skeleton h={190} />
      </main>
    )
  }

  const plan = view.plan
  const asked = view.asked
  const answeredAll = asked.length === 0
  const others = plan.participants.filter((p) => p.participant_id !== view.participant_id)
  const done = plan.participants.filter((p) => p.responded_at).length

  // One question at a time, in the order that unblocks the search soonest:
  // being in comes first, then the two inputs the ranking actually needs.
  const current = asked[0]

  return (
    <main className="answer">
      <header className="answer-head">
        <span className="eyebrow">{plan.rail === 'at_venue' ? 'Splitting a bill' : 'A plan'}</span>
        <h1>{plan.title}</h1>
        <p className="answer-sub">
          {done} of {plan.participants.length} have answered
          {plan.option_count > 0 && <> · {plan.option_count} places on the board</>}
        </p>
      </header>

      {error && <ErrorNote>{error}</ErrorNote>}

      {answeredAll ? (
        <section className="answer-done">
          <div className="answer-tick" aria-hidden>
            ✓
          </div>
          <h2>You’re all set, {view.name}.</h2>
          <p>
            Nothing is charged and nothing is booked yet. When the group settles on something,
            you’ll get your own link to approve your own share — on your own card.
          </p>
          <button className="btn btn-secondary" onClick={() => router.push(`/app/plans/${plan.plan_id}`)}>
            See what everyone said
          </button>
        </section>
      ) : (
        <section className="answer-card" key={current}>
          <div className="answer-progress" aria-hidden>
            {(JSON.parse(JSON.stringify(plan.ask)) as string[]).map((k) => (
              <span key={k} className={asked.includes(k) ? '' : 'is-done'} />
            ))}
          </div>

          {current === 'rsvp' && (
            <>
              <h2>Are you in?</h2>
              <p className="answer-help">
                Say no and you drop out cleanly — no bill, no chasing, and the group keeps going.
              </p>
              <div className="answer-choices">
                <button
                  className="btn btn-primary btn-lg btn-block"
                  disabled={busy}
                  onClick={() => void send({ kind: 'rsvp', in: true })}
                >
                  I’m in
                </button>
                <button
                  className="btn btn-ghost btn-block"
                  disabled={busy}
                  onClick={() => void send({ kind: 'rsvp', in: false })}
                >
                  Can’t make it
                </button>
              </div>
            </>
          )}

          {current === 'availability' && (
            <AvailabilityPicker busy={busy} hint={plan.slots?.when?.hint} onSend={send} />
          )}

          {current === 'location' && <LocationPicker busy={busy} onSend={send} />}

          {current === 'budget' && (
            <BudgetPicker
              busy={busy}
              currency={plan.slots?.currency ?? 'USD'}
              suggestion={plan.slots?.budget_ceiling_minor ?? null}
              onSend={send}
            />
          )}

          {current === 'constraint' && (
            <>
              <h2>Anything to work around?</h2>
              <p className="answer-help">
                Allergies, no stairs, no alcohol — whatever should rule a place out.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  const el = (e.currentTarget.elements.namedItem('c') as HTMLInputElement)
                  if (el.value.trim()) void send({ kind: 'constraint', text: el.value.trim() })
                }}
              >
                <input className="input input-lg" name="c" placeholder="vegetarian" autoFocus />
                <button className="btn btn-primary btn-block btn-lg" style={{ marginTop: 10 }} disabled={busy}>
                  Send
                </button>
              </form>
            </>
          )}

          <p className="answer-privacy">
            {current === 'budget'
              ? 'Your limit is never shown to anyone. It only filters what gets suggested.'
              : 'Nothing here can charge you. Paying is a separate step, on your own card, behind your own passkey.'}
          </p>
        </section>
      )}

      {others.length > 0 && (
        <section className="answer-others">
          <h3>The group</h3>
          <ul>
            {others.map((p, i) => (
              // Their id is redacted for everyone but the organiser (see
              // PlanParticipant), so the name is the only stable-ish key here.
              <li key={p.participant_id ?? `${p.name}-${i}`}>
                <span>{p.name}</span>
                <span className={p.responded_at ? 'tiny' : 'tiny faint'}>
                  {p.rsvp === false
                    ? 'out'
                    : p.responded_at
                      ? `answered ${p.answered.length} of ${plan.ask.length}`
                      : 'hasn’t opened it'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
