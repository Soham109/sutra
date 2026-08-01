'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Shell } from '@/components/shell'
import { BillCapture } from '@/components/bill/capture'
import { PeoplePicker, personKey, type PickedPerson } from '@/components/people/PeoplePicker'
import { useSession } from '@/components/session'
import { ErrorNote } from '@/components/ui'
import { money, toMinor } from '@/lib/format'
import { api } from '@/lib/api'

// Split a real bill.
//
// The parse is deterministic and it reconciles against the printed total, so
// the group can argue with the receipt instead of with us. When the arithmetic
// does not close, the page says so loudly and shows exactly which lines it
// could not read — a splitter that quietly drops a line is worse than no
// splitter at all.
//
// There is no merchant here that Prava can charge, and the page never pretends
// otherwise: this produces an agreement and a signed record, not a payment.

interface ParsedBill {
  items: { name: string; qty: number; unit_amount: number; line_amount: number; confidence: number; source_line: string }[]
  fees: { name: string; amount: number; kind: string }[]
  currency: string
  subtotal: number | null
  total: number | null
  reconciliation: {
    items_sum: number
    fees_sum: number
    computed_total: number
    printed_total: number | null
    delta: number
    balanced: boolean
    note: string
  }
  warnings: string[]
  unparsed_lines: string[]
  /** set when the OCR may have torn the decimals into a separate column */
  integrity?: { suspect: boolean; orphan_lines: number; warning: string }
}

export default function BillPage() {
  const router = useRouter()
  const { user } = useSession()
  const [text, setText] = useState('')
  const [bill, setBill] = useState<ParsedBill | null>(null)
  // You are always in your own split. Seeded with your real account once the
  // session loads, so "you" is a linked member like everyone else you add —
  // not a bare "Me" string nobody could ever notify.
  const [people, setPeople] = useState<PickedPerson[]>([{ key: 'n:me', name: 'Me' }])
  const seededSelf = useRef(false)
  const [claims, setClaims] = useState<Record<number, Set<string>>>({})
  const [venue, setVenue] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  /** set when the text came out of a photo rather than a keyboard */
  const [ocr, setOcr] = useState<{ confidence: number; source: 'ocr' | 'vision' } | null>(null)

  useEffect(() => {
    if (seededSelf.current || !user) return
    seededSelf.current = true
    setPeople((prev) =>
      prev.length === 1 && !prev[0]!.userId
        ? [{ key: personKey({ userId: user.id, name: user.name }), name: user.name, userId: user.id, accent: user.accent }]
        : prev,
    )
  }, [user])

  // The composer on the dashboard hands the receipt over through session
  // storage rather than the URL — a receipt is too long, and too personal, to
  // put in a link that ends up in history.
  useEffect(() => {
    const handoff = sessionStorage.getItem('sutra:bill')
    if (handoff) {
      setText(handoff)
      sessionStorage.removeItem('sutra:bill')
      void parse(handoff)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const parse = async (raw?: string) => {
    const body = (raw ?? text).trim()
    if (!body) return
    setBusy(true)
    setError('')
    try {
      const res = await api.post<ParsedBill>('/v1/bill/parse', { text: body })
      setBill(res)
      // Default: everything shared by everyone, which is what most tables mean.
      setClaims({})
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // Claims and totals are keyed by display name, matching how the engine
  // matches claimants — the account link travels separately, in `people`.
  const named = people.map((p) => p.name)

  const toggle = (itemIdx: number, person: string) =>
    setClaims((prev) => {
      const next = { ...prev }
      const set = new Set(next[itemIdx] ?? named)
      if (set.has(person)) set.delete(person)
      else set.add(person)
      next[itemIdx] = set
      return next
    })

  const claimantsOf = (i: number): string[] => [...(claims[i] ?? new Set(named))]

  const perPerson = (() => {
    if (!bill) return new Map<string, number>()
    const out = new Map<string, number>(named.map((n) => [n, 0]))
    let assigned = 0
    bill.items.forEach((item, i) => {
      const who = claimantsOf(i).filter((n) => named.includes(n))
      if (who.length === 0) return
      // Largest remainder, mirroring the engine so the preview cannot disagree
      // with the number people are asked to accept.
      const base = Math.floor(item.line_amount / who.length)
      let rem = item.line_amount - base * who.length
      who.forEach((n) => {
        const extra = rem > 0 ? 1 : 0
        rem -= extra
        out.set(n, (out.get(n) ?? 0) + base + extra)
      })
      assigned += item.line_amount
    })
    // Fees ride pro-rata on what each person already owes.
    const fees = bill.fees.reduce((s, f) => s + f.amount, 0)
    if (fees !== 0 && assigned > 0) {
      for (const n of named) {
        out.set(n, (out.get(n) ?? 0) + Math.round(((out.get(n) ?? 0) / assigned) * fees))
      }
    }
    return out
  })()

  const create = async (force = false) => {
    if (!bill || named.length === 0) return
    setBusy(true)
    setError('')
    try {
      const res = await api.post<{ group_id: string }>('/v1/bill/split', {
        title: venue.trim() ? `${venue.trim()} — the bill` : 'Split the bill',
        venue: venue.trim() || 'The table',
        text,
        // Anyone picked as a friend carries their real account through, so
        // their seat is notifiable and shows up in their own dashboard —
        // not just a name typed into a box.
        members: people.map((p) => ({ name: p.name, user_id: p.userId })),
        claimants: bill.items.map((_, i) => claimantsOf(i)),
        force,
      })
      router.push(`/app/groups/${res.group_id}`)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  const rec = bill?.reconciliation

  return (
    <Shell crumbs={<span className="here">Split a bill</span>}>
      <div className={`page bill-page${bill ? "" : " is-fresh"}`}>
        <header className="page-head">
          <span className="eyebrow">Split a bill</span>
          <h1>Itemise the receipt</h1>
          <p className="muted">
            Paste or type the lines. We check maths against the printed total. Seats are friends only —
            everyone agrees their amount here, then pays the venue on their own card. Sutra does not charge.
          </p>
        </header>

        {error && <ErrorNote>{error}</ErrorNote>}

        {/* One column until there is actually a bill to sit beside.
            Before that, the right-hand column holds an empty state, and a
            narrow input column stranded against 1300px of canvas reads as a
            page that forgot to centre itself — which is exactly how it was
            described. One thing to do at a time, in the middle. */}
        <div className={`bill-grid${bill ? '' : ' is-empty'}`}>
          <section className="bill-input">
            <BillCapture
              busy={busy}
              onText={(draft, meta) => {
                setText(draft)
                setOcr(meta)
                // Parse straight away: the reconciliation check is the fastest
                // way to find out whether the photo was read well enough.
                void parse(draft)
              }}
            />

            <div className="answer-or" aria-hidden>
              <span>or type it</span>
            </div>

            <label className="field">
              <span className="field-label">
                The receipt
                {ocr && (
                  <span className="tiny faint">
                    {' '}
                    — read from your photo at {ocr.confidence}% confidence. Fix anything wrong.
                  </span>
                )}
              </span>
              <textarea
                className="input bill-text"
                rows={14}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={'2x Margherita          24.00\nPaneer Tikka             380\nCoke ................... 3.50\nService charge            45\nTotal                 452.50'}
              />
            </label>
            <button className="btn btn-primary btn-block" disabled={busy || !text.trim()} onClick={() => void parse()}>
              {busy ? 'Reading…' : bill ? 'Read it again' : 'Read the bill'}
            </button>
          </section>

          <section className="bill-out">
            {!bill ? (
              <div className="empty">
                <h3>Nothing read yet</h3>
                <p>
                  Paste the lines exactly as printed — quantities, dot leaders, tax lines and all.
                  Anything that can’t be read is listed rather than dropped.
                </p>
              </div>
            ) : (
              <>
                {/* A balanced reconciliation is not a green light when the
                    decimals may have been torn off — both sides lose their
                    cents together and the sum agrees with itself. */}
                <div
                  className={`bill-check${
                    bill.integrity?.suspect ? ' is-off' : rec?.balanced ? ' is-ok' : ' is-off'
                  }`}
                >
                  <strong>
                    {bill.integrity?.suspect
                      ? 'These numbers add up, but they may still be wrong'
                      : rec?.balanced
                        ? 'The maths checks out'
                        : 'The maths does not close'}
                  </strong>
                  <p>{bill.integrity?.suspect ? bill.integrity.warning : rec?.note}</p>
                  {bill.integrity?.suspect && rec && (
                    <p className="tiny">
                      Read as {money(rec.computed_total, bill.currency)} and it matches the printed
                      total — but if the cents were lost, every line is short by the same trick.
                      Compare a couple of amounts with the paper before you send this.
                    </p>
                  )}
                  {!rec?.balanced && rec && !bill.integrity?.suspect && (
                    <p className="tiny">
                      Lines add to {money(rec.computed_total, bill.currency)}
                      {rec.printed_total !== null && <> but the receipt says {money(rec.printed_total, bill.currency)}</>}
                      . Fix the text above rather than letting anyone agree to a wrong number.
                    </p>
                  )}
                </div>

                {bill.warnings.length > 0 && (
                  <ul className="bill-warnings">
                    {bill.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                )}

                <PeoplePicker value={people} onChange={setPeople} label="Who’s at the table" />

                <table className="bill-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th className="num">Amount</th>
                      <th>Who had it</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bill.items.map((item, i) => {
                      const who = claimantsOf(i)
                      return (
                        <tr key={i}>
                          <td>
                            {item.name}
                            {item.qty > 1 && <span className="tiny faint"> ×{item.qty}</span>}
                          </td>
                          <td className="num amount">{money(item.line_amount, bill.currency)}</td>
                          <td>
                            <div className="bill-claims">
                              {named.map((n) => (
                                <button
                                  type="button"
                                  key={n}
                                  className={`bill-claim${who.includes(n) ? ' is-on' : ''}`}
                                  onClick={() => toggle(i, n)}
                                  aria-pressed={who.includes(n)}
                                >
                                  {n}
                                </button>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                    {bill.fees.map((f, i) => (
                      <tr key={`f${i}`} className="bill-fee">
                        <td>{f.name}</td>
                        <td className="num amount">{money(f.amount, bill.currency)}</td>
                        <td className="tiny faint">shared in proportion</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {bill.unparsed_lines.length > 0 && (
                  <details className="bill-unparsed">
                    <summary>{bill.unparsed_lines.length} lines were not used</summary>
                    <pre>{bill.unparsed_lines.join('\n')}</pre>
                  </details>
                )}

                <div className="bill-totals">
                  {named.map((n) => (
                    <div className="bill-total-row" key={n}>
                      <span>{n}</span>
                      <span className="amount">{money(perPerson.get(n) ?? 0, bill.currency)}</span>
                    </div>
                  ))}
                </div>

                <label className="field">
                  <span className="field-label">Where were you</span>
                  <input
                    className="input"
                    value={venue}
                    onChange={(e) => setVenue(e.target.value)}
                    placeholder="Toit, Indiranagar"
                  />
                </label>

                <p className="bill-disclosure">
                  No card is charged through sutra on a bill split. Everyone agrees their exact
                  amount here, then pays the venue directly on their own card. What you get is the
                  arithmetic, the agreement, and a signed record of who owed what.
                </p>

                <button
                  className="btn btn-primary btn-lg btn-block"
                  disabled={busy || named.length === 0}
                  onClick={() => void create()}
                >
                  Send friends their shares
                </button>

                {bill.integrity?.suspect && (
                  <button
                    className="btn btn-ghost btn-block"
                    disabled={busy || named.length === 0}
                    onClick={() => void create(true)}
                  >
                    I’ve checked these against the paper — send anyway
                  </button>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </Shell>
  )
}
