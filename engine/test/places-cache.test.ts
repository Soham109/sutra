import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Places } from '../src/places/index.js'
import type { Venue } from '../src/places/overpass.js'

// Cache behaviour belongs to Places, not to the Overpass HTTP/racing layer,
// so it is tested against a mocked findVenues rather than a mocked fetch —
// no network, no timers, no dependence on ENDPOINTS or hedge delays.

// vi.mock calls are hoisted above every import in this file, including a
// plain `const`, so the mock function itself has to be created inside
// vi.hoisted to be usable from the factory below without a TDZ error.
const findVenuesMock = vi.hoisted(() => vi.fn<() => Promise<Venue[]>>())

vi.mock('../src/places/overpass.js', async (importActual) => {
  const actual = await importActual<typeof import('../src/places/overpass.js')>()
  return { ...actual, findVenues: findVenuesMock }
})

function venue(id: string, name: string): Venue {
  return {
    id,
    name,
    place: { label: name, lat: 12.9, lng: 77.6, source: 'overpass' },
    tags: {},
    osm_url: `https://www.openstreetmap.org/${id}`,
  }
}

describe('Places venue cache', () => {
  beforeEach(() => {
    findVenuesMock.mockReset()
  })

  it('caches a successful search and serves the repeat from cache', async () => {
    findVenuesMock.mockResolvedValue([venue('node/1', 'Toit')])
    const places = new Places()
    const near = { lat: 12.9352, lng: 77.6245 }

    const first = await places.search({ near, category: 'bar' })
    expect(first.cached).toBe(false)
    expect(first.venues.map((v) => v.name)).toEqual(['Toit'])

    const second = await places.search({ near, category: 'bar' })
    expect(second.cached).toBe(true)
    expect(second.venues.map((v) => v.name)).toEqual(['Toit'])
    // The whole point of the cache: a repeated demo query never touches Overpass again.
    expect(findVenuesMock).toHaveBeenCalledTimes(1)
  })

  it('does not cache a failure — the next call is a genuine retry, not a stuck empty board', async () => {
    findVenuesMock.mockRejectedValue(new Error('overpass unreachable'))
    const places = new Places()
    const near = { lat: 12.9352, lng: 77.6245 }

    const first = await places.search({ near, category: 'cafe' })
    expect(first.venues).toEqual([])
    expect(first.cached).toBe(false)
    expect(first.reason).toBe('Overpass unavailable: overpass unreachable')

    const second = await places.search({ near, category: 'cafe' })
    expect(second.venues).toEqual([])
    expect(second.cached).toBe(false)
    // A poisoned negative cache would show 1 here forever. It must retry.
    expect(findVenuesMock).toHaveBeenCalledTimes(2)

    // And once Overpass recovers, the very next call succeeds and caches.
    findVenuesMock.mockResolvedValue([venue('node/2', 'Rendezvous')])
    const third = await places.search({ near, category: 'cafe' })
    expect(third.venues.map((v) => v.name)).toEqual(['Rendezvous'])
    expect(third.cached).toBe(false)
    const fourth = await places.search({ near, category: 'cafe' })
    expect(fourth.cached).toBe(true)
    expect(findVenuesMock).toHaveBeenCalledTimes(3)
  })

  it('keys the cache by category, so a different category is never served stale results', async () => {
    findVenuesMock.mockResolvedValueOnce([venue('node/1', 'Toit')]).mockResolvedValueOnce([venue('node/2', 'MTR')])
    const places = new Places()
    const near = { lat: 12.9352, lng: 77.6245 }

    const bar = await places.search({ near, category: 'bar' })
    const cafe = await places.search({ near, category: 'cafe' })
    expect(bar.venues.map((v) => v.name)).toEqual(['Toit'])
    expect(cafe.venues.map((v) => v.name)).toEqual(['MTR'])
    expect(findVenuesMock).toHaveBeenCalledTimes(2)
  })

  it('translates a timeout-shaped error into the honest "did not answer in time" reason', async () => {
    findVenuesMock.mockRejectedValue(new Error('The operation was aborted due to timeout'))
    const places = new Places()
    const res = await places.search({ near: { lat: 12.9, lng: 77.6 }, category: 'restaurant' })
    expect(res.venues).toEqual([])
    expect(res.reason).toBe('Overpass did not answer in time')
  })
})
