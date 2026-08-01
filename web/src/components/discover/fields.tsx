'use client'

import { useId, useState } from 'react'
import { toMinor } from '@/lib/format'

// Small controls the builder reuses. They only compose tokens and classes that
// already exist in globals.css — no new palette, no new shapes.

/** Money in, minor units out. Keeps the raw string while you type so a
 *  half-typed "12." does not get rewritten under the cursor. */
export function MoneyInput({
  value,
  currency = 'USD',
  onChange,
  placeholder = '0.00',
  ariaLabel,
  width,
}: {
  value: number
  currency?: string
  onChange: (minor: number) => void
  placeholder?: string
  ariaLabel?: string
  width?: number | string
}) {
  const [raw, setRaw] = useState<string | null>(null)
  // toMinor knows which currencies have no minor unit — ask it rather than
  // keeping a second copy of that list here.
  const div = toMinor('1', currency) || 100
  const shown = raw ?? (value === 0 ? '' : (value / div).toFixed(div === 1 ? 0 : 2))
  return (
    <input
      className="input mono"
      inputMode="decimal"
      aria-label={ariaLabel}
      placeholder={placeholder}
      style={{ width, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
      value={shown}
      onChange={(e) => {
        const next = e.target.value.replace(/[^0-9.]/g, '')
        setRaw(next)
        onChange(toMinor(next, currency))
      }}
      onBlur={() => setRaw(null)}
    />
  )
}

export function QtyStepper({
  value,
  onChange,
  min = 1,
  max = 99,
}: {
  value: number
  onChange: (n: number) => void
  min?: number
  max?: number
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n))
  return (
    <div className="row" style={{ gap: 0, border: '1px solid var(--line-2)', borderRadius: 'var(--r-sm)', overflow: 'hidden' }}>
      <button
        type="button"
        className="btn btn-ghost"
        style={{ borderRadius: 0, padding: '6px 10px' }}
        onClick={() => onChange(clamp(value - 1))}
        disabled={value <= min}
        aria-label="One fewer"
      >
        −
      </button>
      <input
        className="mono"
        aria-label="Quantity"
        inputMode="numeric"
        value={String(value)}
        onChange={(e) => onChange(clamp(Number(e.target.value.replace(/\D/g, '')) || min))}
        style={{
          width: 38,
          textAlign: 'center',
          border: 0,
          background: 'transparent',
          padding: '6px 0',
          fontVariantNumeric: 'tabular-nums',
        }}
      />
      <button
        type="button"
        className="btn btn-ghost"
        style={{ borderRadius: 0, padding: '6px 10px' }}
        onClick={() => onChange(clamp(value + 1))}
        disabled={value >= max}
        aria-label="One more"
      >
        +
      </button>
    </div>
  )
}

/** A toggle that reads as a chip — used for claimants, roles and presets. */
export function ToggleChip({
  on,
  onClick,
  children,
  title,
}: {
  on: boolean
  onClick: () => void
  children: React.ReactNode
  title?: string
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={title}
      onClick={onClick}
      className={on ? 'chip chip-brand' : 'chip'}
      style={{ cursor: 'pointer', fontWeight: on ? 550 : 450 }}
    >
      {children}
    </button>
  )
}

export function Disclosure({
  summary,
  hint,
  children,
  defaultOpen = false,
}: {
  summary: string
  hint?: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const id = useId()
  return (
    <div>
      <button
        type="button"
        className="btn btn-ghost"
        style={{ paddingLeft: 0 }}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden style={{ display: 'inline-block', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .13s' }}>
          ›
        </span>
        {summary}
      </button>
      {hint && !open && <span className="tiny faint" style={{ marginLeft: 4 }}>{hint}</span>}
      {open && (
        <div id={id} style={{ marginTop: 10 }}>
          {children}
        </div>
      )}
    </div>
  )
}

/** Section scaffold: a title, a one-line reason it exists, and the controls. */
export function Section({
  step,
  title,
  lede,
  aside,
  children,
}: {
  step: number
  title: string
  lede: string
  aside?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="card card-pad">
      <div className="row-between wrap" style={{ marginBottom: 4, alignItems: 'flex-start' }}>
        <div className="row" style={{ gap: 10, alignItems: 'baseline' }}>
          <span className="mono tiny faint">{String(step).padStart(2, '0')}</span>
          <h2 style={{ fontSize: 18 }}>{title}</h2>
        </div>
        {aside}
      </div>
      <p className="small muted" style={{ marginBottom: 14, maxWidth: '62ch' }}>
        {lede}
      </p>
      {children}
    </section>
  )
}

export function Row({ children, gap = 10 }: { children: React.ReactNode; gap?: number }) {
  return (
    <div className="row wrap" style={{ gap }}>
      {children}
    </div>
  )
}
