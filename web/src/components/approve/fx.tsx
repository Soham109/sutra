'use client'

import { useCallback, useEffect, useState } from 'react'
import { clockTime } from '@/lib/format'
import { CCY_KEY, fxConvert, fxCurrencies, type Fx } from './model'

/**
 * The second currency is a reading aid, never the deal. The charge happens in
 * the merchant's currency at the rate snapshotted when the group was created,
 * so we say exactly that instead of implying a live quote.
 */
export function useDisplayCurrency(): [string, (next: string) => void] {
  const [ccy, setCcy] = useState('')

  useEffect(() => {
    try {
      setCcy(localStorage.getItem(CCY_KEY) ?? '')
    } catch {
      /* private mode — the picker just won't persist */
    }
  }, [])

  const set = useCallback((next: string) => {
    setCcy(next)
    try {
      if (next) localStorage.setItem(CCY_KEY, next)
      else localStorage.removeItem(CCY_KEY)
    } catch {
      /* ignore */
    }
  }, [])

  return [ccy, set]
}

export function FxLine({
  minor,
  fx,
  currency,
  display,
}: {
  minor: number
  fx: Fx | null
  currency: string
  display: string
}) {
  if (!fx) return null
  const converted = fxConvert(minor, currency, display, fx)
  if (!converted) return null
  return (
    <div className="tiny muted" style={{ marginTop: 6 }}>
      ≈ <span className="amount">{converted}</span> at the rate snapshotted when the group was created
      <span className="faint"> ({fx.source}, {clockTime(fx.at)})</span>
    </div>
  )
}

export function CurrencyPicker({
  fx,
  currency,
  value,
  onChange,
}: {
  fx: Fx | null
  currency: string
  value: string
  onChange: (next: string) => void
}) {
  if (!fx) return null
  const options = fxCurrencies(fx, currency)
  if (options.length === 0) return null
  return (
    <label className="row tiny faint" style={{ gap: 7, justifyContent: 'center', marginTop: 10 }}>
      Also show in
      <select
        className="select"
        style={{ width: 'auto', padding: '5px 9px', fontSize: 12.5 }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{currency} only</option>
        {options.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </label>
  )
}
