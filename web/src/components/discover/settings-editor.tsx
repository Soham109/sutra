'use client'

import { money } from '@/lib/format'
import { Row, Section, ToggleChip } from './fields'
import { STRAGGLER_OPTIONS, type StragglerPolicy, capFor } from './model'

const DEADLINES = [
  { minutes: 15, label: '15 min' },
  { minutes: 60, label: '1 hour' },
  { minutes: 240, label: '4 hours' },
  { minutes: 1440, label: '1 day' },
  { minutes: 4320, label: '3 days' },
]

const TOLERANCES = [
  { bps: 0, label: 'Exact' },
  { bps: 50, label: '0.5%' },
  { bps: 100, label: '1%' },
  { bps: 300, label: '3%' },
]

export function SettingsEditor({
  deadlineMinutes,
  onDeadline,
  toleranceBps,
  onTolerance,
  straggler,
  onStraggler,
  noBlame,
  onNoBlame,
  sampleShare,
  currency,
}: {
  deadlineMinutes: number
  onDeadline: (n: number) => void
  toleranceBps: number
  onTolerance: (n: number) => void
  straggler: StragglerPolicy
  onStraggler: (s: StragglerPolicy) => void
  noBlame: boolean
  onNoBlame: (v: boolean) => void
  sampleShare: number
  currency: string
}) {
  return (
    <Section
      step={5}
      title="Settings"
      lede="How long people have, how much price drift you will absorb without asking again, and what happens to whoever never answers."
      collapsible
      summary={`${deadlineMinutes} min to answer · ${(toleranceBps / 100).toFixed(2)}% drift allowed`}
    >
      <div className="col" style={{ gap: 18 }}>
        <div className="col" style={{ gap: 8 }}>
          <span className="field-label">People have</span>
          <Row gap={6}>
            {DEADLINES.map((d) => (
              <ToggleChip key={d.minutes} on={deadlineMinutes === d.minutes} onClick={() => onDeadline(d.minutes)}>
                {d.label}
              </ToggleChip>
            ))}
            <label className="row" style={{ gap: 6 }}>
              <input
                className="input mono"
                type="number"
                min={5}
                max={20160}
                value={deadlineMinutes}
                style={{ width: 92 }}
                aria-label="Deadline in minutes"
                onChange={(e) => onDeadline(Math.max(5, Math.min(20160, Number(e.target.value) || 5)))}
              />
              <span className="small muted">minutes</span>
            </label>
          </Row>
          <p className="tiny faint">
            Mandates expire when the group does. Nobody keeps a live claim on anybody’s card afterwards.
          </p>
        </div>

        <div className="col" style={{ gap: 8 }}>
          <span className="field-label">Price tolerance</span>
          <Row gap={6}>
            {TOLERANCES.map((t) => (
              <ToggleChip key={t.bps} on={toleranceBps === t.bps} onClick={() => onTolerance(t.bps)}>
                {t.label}
              </ToggleChip>
            ))}
            <label className="row" style={{ gap: 6 }}>
              <input
                className="input mono"
                type="number"
                min={0}
                max={2000}
                step={25}
                value={toleranceBps}
                style={{ width: 92 }}
                aria-label="Tolerance in basis points"
                onChange={(e) => onTolerance(Math.max(0, Math.min(2000, Number(e.target.value) || 0)))}
              />
              <span className="small muted">bps</span>
            </label>
          </Row>
          <p className="tiny faint">
            Absorbs small price drift without asking everyone again. A{' '}
            <span className="mono">{money(sampleShare, currency)}</span> share is approved with a cap of{' '}
            <span className="mono">{money(capFor(sampleShare, toleranceBps), currency)}</span> — anything above
            that stops the charge and re-opens approval instead of quietly costing more.
          </p>
        </div>

        <div className="col" style={{ gap: 8 }}>
          <span className="field-label">If somebody never answers</span>
          <Row gap={6}>
            {STRAGGLER_OPTIONS.map((s) => (
              <ToggleChip key={s.value} on={straggler === s.value} onClick={() => onStraggler(s.value)}>
                {s.label}
              </ToggleChip>
            ))}
          </Row>
          <p className="tiny faint">{STRAGGLER_OPTIONS.find((s) => s.value === straggler)?.line}</p>
        </div>

        <div className="col" style={{ gap: 8 }}>
          <label className="row" style={{ gap: 9, alignItems: 'flex-start' }}>
            <input
              className="checkbox"
              type="checkbox"
              checked={noBlame}
              style={{ marginTop: 4 }}
              onChange={(e) => onNoBlame(e.target.checked)}
            />
            <span>
              <span style={{ fontWeight: 550, fontSize: 14 }}>No-blame declines</span>
              <span className="tiny faint" style={{ display: 'block' }}>
                Declines show to the group as “a member”. You, as organiser, still see who — the receipt is
                complete either way. Turn this on when the group is a friendship, not a company.
              </span>
            </span>
          </label>
        </div>
      </div>
    </Section>
  )
}
