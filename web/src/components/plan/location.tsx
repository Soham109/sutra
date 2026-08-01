'use client'

import { useState } from 'react'
import { api } from '@/lib/api'
import type { Place, SignalPayload } from './model'

// Where you would be travelling from.
//
// Two ways in, because the honest answer differs: the phone's own fix is exact
// and instant but only right if you are answering from home, and a typed place
// is what most people actually mean ("I'll be coming from work"). Neither is
// guessed — the typed one goes through a real geocoder, and both carry their
// provenance so the ranking can say where a distance came from.

export function LocationPicker({
  busy,
  onSend,
}: {
  busy: boolean
  onSend: (p: SignalPayload) => void | Promise<void>
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Place[] | null>(null)
  const [status, setStatus] = useState('')
  const [locating, setLocating] = useState(false)

  const search = async (e: React.FormEvent) => {
    e.preventDefault()
    const q = query.trim()
    if (!q) return
    setStatus('')
    setResults(null)
    try {
      const res = await api.get<{ places: Place[]; reason?: string }>(
        `/v1/places/geocode?q=${encodeURIComponent(q)}`,
      )
      setResults(res.places)
      if (res.places.length === 0) {
        setStatus(res.reason ?? `Nothing matched “${q}”. Try adding the city.`)
      }
    } catch (err) {
      setStatus((err as Error).message)
    }
  }

  const useDevice = () => {
    if (!('geolocation' in navigator)) {
      setStatus('This browser can’t share a location. Type a place instead.')
      return
    }
    setLocating(true)
    setStatus('')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false)
        void onSend({
          kind: 'location',
          place: {
            label: 'Where I am now',
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            source: 'device',
          },
        })
      },
      (err) => {
        setLocating(false)
        setStatus(
          err.code === err.PERMISSION_DENIED
            ? 'Location is blocked for this site. Type a place instead — it works just as well.'
            : 'Couldn’t get a fix. Type a place instead.',
        )
      },
      { timeout: 8000, maximumAge: 60_000 },
    )
  }

  return (
    <>
      <h2>Where are you coming from?</h2>
      <p className="answer-help">
        Only used to find somewhere that is fair on everyone’s travel. Your exact position is never
        shown to the group — they see a name, like “Indiranagar”.
      </p>

      <button
        type="button"
        className="btn btn-secondary btn-block btn-lg"
        onClick={useDevice}
        disabled={busy || locating}
      >
        {locating ? 'Getting your location…' : 'Use my current location'}
      </button>

      <div className="answer-or" aria-hidden>
        <span>or</span>
      </div>

      <form onSubmit={search}>
        <div className="row" style={{ gap: 8 }}>
          <input
            className="input input-lg grow"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Indiranagar, Bangalore"
            aria-label="Search for the place you are travelling from"
          />
          <button className="btn btn-secondary" disabled={!query.trim()}>
            Find
          </button>
        </div>
      </form>

      {status && <p className="answer-status">{status}</p>}

      {results && results.length > 0 && (
        <ul className="place-results">
          {results.map((p, i) => (
            <li key={i}>
              <button type="button" disabled={busy} onClick={() => void onSend({ kind: 'location', place: p })}>
                <span className="place-label">{p.label}</span>
                {p.address && <span className="tiny faint">{p.address}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
