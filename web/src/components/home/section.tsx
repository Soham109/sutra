'use client'

/**
 * A titled block. Every page in this product is a stack of these, so the
 * rhythm — eyebrow-weight heading, one optional hint, one optional action —
 * stays identical from Home to Settings.
 */
export function Section({
  title,
  hint,
  live,
  action,
  children,
}: {
  title: string
  hint?: string
  /** shows the breathing brand dot: something is happening right now */
  live?: boolean
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section>
      <div className="row-between wrap" style={{ marginBottom: 10, gap: 10 }}>
        <div className="row" style={{ gap: 9, minWidth: 0 }}>
          {live && <span className="dot dot-brand dot-live" />}
          <h2>{title}</h2>
          {hint && <span className="small faint">{hint}</span>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

/** Label above a value, used wherever a fact needs naming. */
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="col" style={{ gap: 3, minWidth: 0 }}>
      <span className="eyebrow">{label}</span>
      <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{children}</span>
    </div>
  )
}
