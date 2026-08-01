'use client'

import { useEffect, useState } from 'react'
import type { Receipt } from './model'

/**
 * Verify-it-yourself. The whole point of signing the receipt is that you do not
 * have to believe this page, so the public key and the two commands that check
 * it are printed here in full — copyable, and legible on paper.
 */
export function VerifyPanel({ receipt }: { receipt: Receipt }) {
  const [origin, setOrigin] = useState('')
  useEffect(() => setOrigin(window.location.origin), [])

  const commands = [
    `curl -s ${origin || '<origin>'}/api/v1/groups/${receipt.group_id}/receipt > receipt.json`,
    'npm run -w cli gmp -- verify receipt.json',
  ].join('\n')

  return (
    <section className="card card-pad col" style={{ gap: 12 }}>
      <div>
        <h3>Verify this yourself</h3>
        <p className="small muted" style={{ maxWidth: '58ch', marginTop: 4 }}>
          Don&apos;t trust this page. The receipt is signed with Ed25519 over its canonical JSON; the verifier
          re-hashes every entry, re-links the chain, re-adds the totals and checks the signature. It needs
          nothing from us but the file.
        </p>
      </div>

      <div>
        <div className="eyebrow" style={{ marginBottom: 5 }}>
          Ed25519 public key
        </div>
        <div className="rc-key">{receipt.public_key}</div>
      </div>

      <div>
        <div className="row-between" style={{ marginBottom: 5 }}>
          <span className="eyebrow">Check it in two commands</span>
          <CopyButton text={commands} label="Copy commands" />
        </div>
        <div className="rc-code">{commands}</div>
      </div>

      {receipt.signature && (
        <div>
          <div className="row-between" style={{ marginBottom: 5 }}>
            <span className="eyebrow">Signature</span>
            <CopyButton text={receipt.signature} label="Copy signature" />
          </div>
          <div className="rc-key">{receipt.signature}</div>
        </div>
      )}

      <p className="tiny faint">
        Signed over the canonical JSON of everything above except the signature itself — the chain head,
        the totals, and every entry.
      </p>
    </section>
  )
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setDone(true)
      setTimeout(() => setDone(false), 1600)
    } catch {
      setDone(false)
    }
  }

  return (
    <button className="btn btn-secondary tiny rc-noprint no-print" onClick={() => void copy()} style={{ padding: '4px 9px' }}>
      {done ? '✓ Copied' : label}
    </button>
  )
}
