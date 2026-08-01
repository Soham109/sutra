import { describe, expect, it } from 'vitest'
import { locationPhrase } from '../src/agent/extract.js'

// Finding the place somebody actually named.
//
// This function decides whether the options board has anywhere to search. It
// used to require a capital letter, so "dinner this saturday in khan market"
// named nowhere: no geocode, no anchor, and a board that told the user
// "options appear once somebody shares a location" about a sentence that had
// just shared one. People do not capitalise when they type quickly, and a
// planner that only works for people who do is not a planner.
//
// The opposite failure is worse, though. Matching anything after "at" turns
// "dinner at 8" into a geocode for "8" and puts the whole group somewhere
// random. These pin both edges.

describe('places people actually name', () => {
  it('finds a lowercase one', () => {
    expect(locationPhrase('dinner this satirday in khan market')).toBe('khan market')
    expect(locationPhrase('somewhere to eat near indiranagar')).toBe('indiranagar')
    expect(locationPhrase('coffee around bandra west tomorrow')).toBe('bandra west')
  })

  it('still finds a capitalised one', () => {
    expect(locationPhrase('Dinner Saturday near Koramangala')).toBe('Koramangala')
    expect(locationPhrase('drinks in Hauz Khas Village')).toBe('Hauz Khas Village')
  })

  it('reads a multi-word name without swallowing the rest of the sentence', () => {
    expect(locationPhrase('lunch in khan market on saturday')).toBe('khan market')
    expect(locationPhrase('dinner near church street tonight')).toBe('church street')
  })
})

describe('things that are not places', () => {
  it('does not read a time as an address', () => {
    expect(locationPhrase('dinner at 8')).toBeNull()
    expect(locationPhrase('meet at 7:30pm')).toBeNull()
  })

  it('does not read filler as an address', () => {
    expect(locationPhrase('something to do in the evening')).toBeNull()
    expect(locationPhrase('lunch at the usual')).toBeNull()
    expect(locationPhrase('dinner in town tomorrow')).toBeNull()
  })

  it('returns nothing when no place was named at all', () => {
    expect(locationPhrase('somewhere to watch the match with the boys tonight')).toBeNull()
    expect(locationPhrase('dinner saturday')).toBeNull()
  })

  /** One or two characters is noise, not a name worth sending to a geocoder. */
  it('ignores a scrap too short to be a name', () => {
    expect(locationPhrase('meet at ko')).toBeNull()
  })
})
