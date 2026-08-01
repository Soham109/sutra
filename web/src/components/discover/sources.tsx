'use client'

import type { SearchResponse } from '@/lib/api'

// Provenance, stated plainly. Every result came from somewhere, some places
// answered slowly, some did not answer at all — hiding that would make the
// results look more authoritative than they are.

export interface SourceHealth {
  kind: string
  label: string
  available: boolean
  reason?: string
}

export function SourceStrip({
  sources,
  tookMs,
}: {
  sources: SearchResponse['sources']
  tookMs: number
}) {
  if (sources.length === 0) return null
  return (
    <div className="row wrap" style={{ gap: 8 }}>
      {sources.map((s) => (
        <span
          key={s.kind}
          className="chip"
          title={s.error ? `${s.label} failed: ${s.error}` : `${s.label} answered in ${s.ms}ms`}
        >
          <span className={s.error ? 'dot dot-warn' : s.count > 0 ? 'dot dot-brand' : 'dot'} />
          <span>{s.label}</span>
          <span className="faint">·</span>
          <span className="mono">
            {s.count} result{s.count === 1 ? '' : 's'}
          </span>
          <span className="faint">·</span>
          <span className="mono faint">{Math.round(s.ms)}ms</span>
          {s.error && (
            <>
              <span className="faint">·</span>
              <span style={{ color: 'var(--warn)' }}>didn’t answer</span>
            </>
          )}
        </span>
      ))}
      <span className="tiny faint mono" style={{ marginLeft: 'auto' }}>
        {Math.round(tookMs)}ms total
      </span>
    </div>
  )
}

export function SourceErrors({ sources }: { sources: SearchResponse['sources'] }) {
  const failed = sources.filter((s) => s.error)
  if (failed.length === 0) return null
  return (
    <p className="tiny faint" style={{ lineHeight: 1.6 }}>
      {failed.map((s) => (
        <span key={s.kind} style={{ display: 'block' }}>
          <b style={{ fontWeight: 550 }}>{s.label}</b> errored — {s.error}. Its results are missing from this
          page; the rest are unaffected.
        </span>
      ))}
    </p>
  )
}

/** What is switched off right now, and why. Quiet, but never hidden. */
export function UnavailableSources({ health }: { health: SourceHealth[] }) {
  const off = health.filter((s) => !s.available)
  if (off.length === 0) return null
  return (
    <p className="tiny faint" style={{ lineHeight: 1.6 }}>
      Not searching{' '}
      {off.map((s, i) => (
        <span key={s.kind}>
          {i > 0 && (i === off.length - 1 ? ' and ' : ', ')}
          <b style={{ fontWeight: 550 }}>{s.label}</b>
          {s.reason ? ` (${s.reason})` : ''}
        </span>
      ))}
      . Pasting a link from those stores still works.
    </p>
  )
}
