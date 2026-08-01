import { afterEach, describe, expect, it, vi } from 'vitest'
import { type RaceTask, findVenues, raceHedged } from '../src/places/overpass.js'

// No network in here. `raceHedged` is the racing/hedging/budget primitive
// findVenues now runs Overpass mirrors through — it knows nothing about OSM,
// so it is verified with fake tasks on millisecond timers instead of a live
// query. The one findVenues test at the bottom checks the wiring (real
// ENDPOINTS, real query building) without ever waiting on a hedge delay: it
// only needs the first mirror, which starts immediately.

afterEach(() => {
  vi.unstubAllGlobals()
})

function delay<T>(ms: number, value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

/** Never settles on its own — only when the race aborts it. Simulates a hung mirror. */
function hang<T>(signal: AbortSignal): Promise<T> {
  return new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
  })
}

describe('raceHedged', () => {
  it('takes the first fulfilment and never even starts a later hedge', async () => {
    const late = vi.fn(() => delay(200, 'late'))
    const tasks: RaceTask<string>[] = [
      { delay_ms: 0, run: () => delay(5, 'fast') },
      { delay_ms: 50, run: late },
    ]
    const result = await raceHedged(tasks, { budget_ms: 2000 })
    expect(result).toBe('fast')
    // The race was won and aborted well before the 50ms hedge delay elapsed.
    expect(late).not.toHaveBeenCalled()
  })

  it('a hung primary does not block a later hedge from winning', async () => {
    const tasks: RaceTask<string>[] = [
      { delay_ms: 0, run: hang },
      { delay_ms: 15, run: () => delay(5, 'mirror answered') },
    ]
    const started = Date.now()
    const result = await raceHedged(tasks, { budget_ms: 2000 })
    expect(result).toBe('mirror answered')
    // ~20ms (15ms hedge + 5ms fetch), not anywhere near the 2s budget.
    expect(Date.now() - started).toBeLessThan(500)
  })

  it('surfaces the last rejection when every task fails', async () => {
    const tasks: RaceTask<string>[] = [
      { delay_ms: 0, run: () => Promise.reject(new Error('first mirror: 504')) },
      {
        delay_ms: 10,
        run: () =>
          new Promise((_resolve, reject) => setTimeout(() => reject(new Error('second mirror: remark')), 5)),
      },
    ]
    await expect(raceHedged(tasks, { budget_ms: 2000 })).rejects.toThrow('second mirror: remark')
  })

  it('the total budget cuts a fully-hung race off instead of waiting forever', async () => {
    const tasks: RaceTask<string>[] = [
      { delay_ms: 0, run: hang },
      { delay_ms: 10, run: hang },
    ]
    const started = Date.now()
    await expect(raceHedged(tasks, { budget_ms: 40 })).rejects.toThrow()
    const elapsed = Date.now() - started
    expect(elapsed).toBeGreaterThanOrEqual(35)
    expect(elapsed).toBeLessThan(1000)
  })

  it('a caller abort is honoured immediately, not treated as every task failing', async () => {
    const controller = new AbortController()
    controller.abort(new Error('caller gave up'))
    const tasks: RaceTask<string>[] = [{ delay_ms: 0, run: hang }]
    await expect(raceHedged(tasks, { budget_ms: 5000, signal: controller.signal })).rejects.toThrow(
      'caller gave up',
    )
  })

  it('does not start a hedge whose turn only arrives after the budget is gone', async () => {
    const neverCalled = vi.fn(() => delay(5, 'too late'))
    const tasks: RaceTask<string>[] = [
      { delay_ms: 0, run: hang },
      { delay_ms: 100, run: neverCalled },
    ]
    await expect(raceHedged(tasks, { budget_ms: 30 })).rejects.toThrow()
    expect(neverCalled).not.toHaveBeenCalled()
  })
})

describe('findVenues wiring', () => {
  it('parses whatever the first-answering endpoint returns, real ENDPOINTS and all', async () => {
    const fetchMock = vi.fn(async (target: unknown) => {
      const host = new URL(String(target)).hostname
      if (host === 'overpass-api.de') {
        return new Response(
          JSON.stringify({
            elements: [
              { type: 'node', id: 1, lat: 12.9, lon: 77.6, tags: { amenity: 'cafe', name: 'Third Wave' } },
            ],
          }),
          { status: 200 },
        )
      }
      // Every other mirror has a non-zero hedge delay; the race must be over
      // before any of them are contacted, so reaching this is itself a bug.
      throw new Error(`unexpected fetch to ${host}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const venues = await findVenues({
      center: { lat: 12.9352, lng: 77.6245 },
      radius_m: 1000,
      filters: [{ key: 'amenity', value: 'cafe' }],
    })

    expect(venues).toHaveLength(1)
    expect(venues[0]?.name).toBe('Third Wave')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
