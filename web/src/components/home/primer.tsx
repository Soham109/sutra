'use client'

const STEPS: { title: string; body: string }[] = [
  {
    title: 'One cart, one deadline',
    body: 'Somebody builds the cart and invites friends. Everyone sees the same items, the same total and the same clock.',
  },
  {
    title: 'Everyone approves their own share',
    body: 'Each friend agrees on their own phone. On the card rail that is a Prava mandate; at a venue it is just the amount they will pay the waiter.',
  },
  {
    title: 'The rule chooses the finish line',
    body: 'After the rule passes, the chosen rail runs. Charging is recoverable and may report a truthful partial; POS, checkout and venue rails record agreement without claiming payment.',
  },
]

/** The protocol in three lines. This is what a judge with a fresh account reads first. */
export function ProtocolPrimer() {
  return (
    <div
      style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}
      role="list"
    >
      {STEPS.map((s, i) => (
        <div className="well" key={s.title} role="listitem" style={{ textAlign: 'left' }}>
          <div className="mono tiny" style={{ color: 'var(--brand)', marginBottom: 6 }}>
            {String(i + 1).padStart(2, '0')}
          </div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{s.title}</div>
          <p className="small muted" style={{ margin: 0 }}>
            {s.body}
          </p>
        </div>
      ))}
    </div>
  )
}

const FLOW: { step: string; body: string }[] = [
  {
    step: 'You approve',
    body: 'Each member approves their own Prava mandate, on their own device, for their own share. Sutra never asks for a card number and never sees one.',
  },
  {
    step: 'The engine commits',
    body: 'When the group policy is satisfied, the engine locks one charge plan and processes it sequentially with stable idempotency references and reconciliation before retry.',
  },
  {
    step: 'Prava mints the credential',
    body: 'Each charge mints a single-use credential against that member’s own card — locked to the merchant, capped at the approved amount, expiring with the group.',
  },
  {
    step: 'Every outcome stays explicit',
    body: 'If the policy fails before commit, unused mandates are cancelled. After charging starts, a mixed irreversible result is reported as partial instead of being called atomic.',
  },
]

/** How your money moves. Shown in Settings, written to be read by someone sceptical. */
export function MoneyFlow() {
  return (
    <>
      <ol className="col" style={{ gap: 14, margin: 0, padding: 0, listStyle: 'none' }}>
        {FLOW.map((f, i) => (
          <li className="row" key={f.step} style={{ gap: 12, alignItems: 'flex-start' }}>
            <span
              className="mono tiny"
              style={{
                flex: 'none',
                width: 24,
                height: 24,
                display: 'grid',
                placeItems: 'center',
                borderRadius: 999,
                background: 'var(--brand-soft)',
                border: '1px solid var(--brand-line)',
                color: 'var(--brand-ink)',
                marginTop: 1,
              }}
              aria-hidden
            >
              {i + 1}
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{f.step}</div>
              <p className="small muted" style={{ margin: 0 }}>
                {f.body}
              </p>
            </div>
          </li>
        ))}
      </ol>
      <p className="guardrail" style={{ marginTop: 16 }}>
        The engine never sees a card number and never holds funds. It holds mandates and an event log, and the spending
        limits are enforced at the card network — not by this app.
      </p>
    </>
  )
}
