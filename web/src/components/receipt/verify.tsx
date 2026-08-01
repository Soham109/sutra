'use client'

import { useEffect, useState } from 'react'
import type { Receipt } from './model'

/**
 * Verify-it-yourself. Pin the receipt's public key against the engine's
 * published /health key so a self-signed forgery cannot pass a casual glance.
 */
export function VerifyPanel({ receipt }: { receipt: Receipt }) {
  const [origin, setOrigin] = useState('')
  const [engineKey, setEngineKey] = useState<string | null>(null)
  const [keyStatus, setKeyStatus] = useState<'loading' | 'match' | 'mismatch' | 'unavailable'>('loading')

  useEffect(() => setOrigin(window.location.origin), [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/health', { cache: 'no-store' })
        if (!res.ok) throw new Error('health failed')
        const data = (await res.json()) as { receipt_public_key?: string }
        if (cancelled) return
        const key = data.receipt_public_key ?? null
        setEngineKey(key)
        if (!key) setKeyStatus('unavailable')
        else setKeyStatus(key === receipt.public_key ? 'match' : 'mismatch')
      } catch {
        if (!cancelled) setKeyStatus('unavailable')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [receipt.public_key])

  const commands = [
    `curl -s ${origin || '<origin>'}/api/v1/groups/${receipt.group_id}/receipt > receipt.json`,
    'npm run -w cli gmp -- verify receipt.json',
  ].join('\n')

  return (
    <section className="card card-pad col" style={{ gap: 12 }}>
      <div>
        <h3>Verify this yourself</h3>
        <p className="small muted" style={{ maxWidth: '58ch', marginTop: 4 }}>
          Don&apos;t trust this page alone. The receipt is signed with Ed25519 over its canonical JSON. Check that the
          public key below matches the engine&apos;s live key from <code className="mono">/health</code>, then run the
          CLI verifier — it pins against that same key when the engine is reachable.
        </p>
      </div>

      {keyStatus === 'match' && (
        <div className="banner banner-ok" style={{ padding: 12 }}>
          <b>Public key matches the live engine</b>
        </div>
      )}
      {keyStatus === 'mismatch' && (
        <div className="banner banner-bad" style={{ padding: 12 }}>
          <b>Public key does not match the engine</b>
          <p className="small" style={{ margin: '6px 0 0' }}>
            This file was not signed by the running sutra engine
            {engineKey ? ` (expected ${engineKey.slice(0, 16)}…)` : ''}.
          </p>
        </div>
      )}

      <div>
        <div className="eyebrow" style={{ marginBottom: 5 }}>
          Ed25519 public key
        </div>
        <div className="rc-key">{receipt.public_key}</div>
      </div>

      <div>
        <div className="row-between" style={{ marginBottom: 5 }}>
          <span className="eyebrow">Check it in two commands</span>
        </div>
        <pre className="rc-commands">{commands}</pre>
      </div>
    </section>
  )
}
