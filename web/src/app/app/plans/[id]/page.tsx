'use client'

import Link from 'next/link'
import { use, useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Shell } from '@/components/shell'
import { Avatar, Countdown, ErrorNote, Skeleton } from '@/components/ui'
import { OptionCard } from '@/components/plan/option-card'
import { ConvertPanel } from '@/components/plan/convert'
import type { PlanView, RankedOptions } from '@/components/plan/model'
import { ChatThread } from '@/components/chat/ChatThread'
import { api } from '@/lib/api'

// The organiser's view of a plan in flight: who has answered, what the group's
// common window actually is, and the ranked board. It ends at one button —
// turning the chosen option into a real group with real mandates.

export default function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [plan, setPlan] = useState<PlanView | null>(null)
  const [ranked, setRanked] = useState<RankedOptions | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const [p, r] = await Promise.all([
        api.get<PlanView>(`/v1/plans/${id}`),
        api.get<RankedOptions>(`/v1/plans/${id}/options`),
      ])
      // Merge stashed organiser links so anonymous create → navigate still
      // shows "copy link" chips after the re-GET redacts participant_id.
      try {
        const raw = sessionStorage.getItem(`sutra:plan-links:${id}`)
        if (raw) {
          const links = JSON.parse(raw) as Record<string, string>
          p.participants = p.participants.map((part) =>
            part.participant_id ? part : { ...part, participant_id: links[part.name] ?? null },
          )
        }
      } catch {
        /* ignore */
      }
      setPlan(p)
      setRanked(r)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [id])

  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 5000)
    return () => clearInterval(t)
  }, [load])

  const refresh = async () => {
    setBusy(true)
    setError('')
    try {
      await api.post(`/v1/plans/${id}/options/refresh`, {})
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const choose = async (optionId: string) => {
    setBusy(true)
    try {
      await api.post(`/v1/plans/${id}/choose`, { option_id: optionId })
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!plan) {
    return (
      <Shell crumbs={<span className="here">Plan</span>}>
        <div className="page">
          {error ? <ErrorNote>{error}</ErrorNote> : <Skeleton h={220} />}
        </div>
      </Shell>
    )
  }

  const going = plan.participants.filter((p) => p.rsvp !== false)
  const best = ranked?.best_windows[0]
  const chosen = ranked?.options.find((o) => o.option.option_id === plan.chosen_option_id)

  return (
    <Shell
      crumbs={
        <>
          <Link href="/app/groups">Activity</Link>
          <span className="sep">/</span>
          <span className="here">{plan.title}</span>
        </>
      }
    >
      <div className="page plan-page">
        <header className="plan-head">
          <div>
            <span className="eyebrow">{plan.status === 'converted' ? 'Became a group' : 'Deciding'}</span>
            <h1>{plan.title}</h1>
            <p className="plan-intent">“{plan.intent_text}”</p>
          </div>
          <div className="plan-head-side">
            <Countdown to={plan.deadline_at} />
            {plan.group_id && (
              <Link className="btn btn-primary" href={`/app/groups/${plan.group_id}`}>
                Go to the group ↗
              </Link>
            )}
          </div>
        </header>

        {error && <ErrorNote>{error}</ErrorNote>}

        <section className="plan-answers">
          <div className="section-head">
            <h2>
              {plan.responded_count} of {plan.participants.length} answered
            </h2>
            <button
              className="text-button"
              onClick={() => void refresh()}
              disabled={busy || !plan.slots?.where?.label}
              title={!plan.slots?.where?.label ? 'Share a location first' : undefined}
            >
              {busy ? 'Searching…' : plan.slots?.where?.label ? 'Search again' : 'Waiting on a location'}
            </button>
          </div>

          <div className="answer-chips">
            {plan.participants.map((p) => (
              <div
                className={`answer-chip${p.rsvp === false ? ' is-out' : p.responded_at ? ' is-in' : ''}`}
                key={p.participant_id ?? p.name}
              >
                <Avatar name={p.name} size="sm" />
                <div>
                  <span className="answer-chip-name">{p.name}</span>
                  <span className="tiny faint">
                    {p.rsvp === false
                      ? 'out'
                      : p.responded_at
                        ? p.location_label ?? `${p.answered.length} answered`
                        : 'not opened'}
                  </span>
                </div>
                {/* participant_id is only ever present here for the plan's own
                    organiser — see PlanParticipant. Everyone else genuinely
                    cannot get this link, so there is nothing to copy. */}
                {!p.responded_at && p.participant_id && (
                  <button
                    className="chip-copy"
                    title="Copy their link"
                    onClick={() => {
                      void navigator.clipboard.writeText(`${location.origin}/p/${p.participant_id}`)
                    }}
                  >
                    copy link
                  </button>
                )}
              </div>
            ))}
          </div>

          {best ? (
            <p className="plan-window">
              Best common window:{' '}
              <b>
                {new Date(best.window.start).toLocaleString([], {
                  weekday: 'short',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
                {' – '}
                {new Date(best.window.end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              </b>{' '}
              — {best.count} of {going.length} can make it.
            </p>
          ) : (
            <p className="plan-window faint">
              No window suits everyone yet. As more people send their times, a slot appears here.
            </p>
          )}
        </section>

        <section>
          <div className="section-head">
            <h2>{ranked?.options.length ?? 0} options, ranked on what people said</h2>
          </div>

          {!ranked || ranked.options.length === 0 ? (
            <div className="empty">
              <h3>Nothing on the board yet</h3>
              <p>
                {ranked?.note
                  ? ranked.note
                  : plan.slots?.where?.label
                    ? `No places came back near ${plan.slots.where.label} yet — OpenStreetMap can time out under load. Try searching again, or widen the area.`
                    : 'Options appear once somebody shares a location — there is nowhere to search around until then.'}
              </p>
              {plan.slots?.where?.label ? (
                <button className="btn btn-secondary" onClick={() => void refresh()} disabled={busy}>
                  {busy ? 'Searching…' : 'Search again'}
                </button>
              ) : null}
            </div>
          ) : (
            <div className="opt-list">
              {ranked.options.map((o, i) => (
                <OptionCard
                  key={o.option.option_id}
                  option={o.option}
                  score={o.score}
                  rank={i + 1}
                  chosen={o.option.option_id === plan.chosen_option_id}
                  busy={busy}
                  onChoose={plan.terminal ? undefined : () => void choose(o.option.option_id)}
                />
              ))}
            </div>
          )}
        </section>

        {chosen && !plan.group_id && (
          <ConvertPanel
            planId={plan.plan_id}
            option={chosen.option}
            currency={plan.slots?.currency ?? 'USD'}
            headcount={going.length}
            onDone={(groupId) => router.push(`/app/groups/${groupId}`)}
          />
        )}

        <ChatThread scope="plan" id={plan.plan_id} />
      </div>
    </Shell>
  )
}
