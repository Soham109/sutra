'use client'

import { useState } from 'react'

export function CopyButton({ text, className = 'btn btn-secondary tiny' }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Clipboard permission denied or unavailable (older Safari, insecure
      // context). Silent no-op rather than an alert — the command is still
      // right there, selectable by hand.
      return
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  return (
    <button type="button" className={className} onClick={copy} aria-label="Copy command">
      {copied ? 'copied' : 'copy'}
    </button>
  )
}
