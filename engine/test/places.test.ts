import { describe, expect, it } from 'vitest'
import {
  CATEGORIES,
  Places,
  buildQuery,
  categoryFilters,
  composeAddress,
  distanceM,
  nameSearchFilters,
  normalise,
  rankByDistance,
  resolveCategory,
  toVenue,
} from '../src/places/index.js'
import type { OverpassElement } from '../src/places/overpass.js'

// No network in here. Everything below is the pure half of the venue rail:
// the Overpass response shapes we have to survive, and the taxonomy.

// ---------------------------------------------------------------------------
// Overpass normalisation
// ---------------------------------------------------------------------------

const node: OverpassElement = {
  type: 'node',
  id: 1459472858,
  lat: 12.9346877,
  lon: 77.6116748,
  tags: {
    'addr:city': 'Bangalore',
    'addr:housename': 'Forum Mall',
    'addr:street': 'Hosur Road',
    amenity: 'cinema',
    name: 'PVR',
    screen: '12',
    website: 'https://example.test/pvr',
    phone: '+91 80 1234 5678',
    opening_hours: 'Mo-Su 10:00-23:30',
  },
}

const way: OverpassElement = {
  type: 'way',
  id: 133179621,
  center: { lat: 12.9318731, lon: 77.6076887 },
  tags: { amenity: 'cinema', name: 'Srinivasa Theatre', 'addr:street': '8th Cross' },
}

const relation: OverpassElement = {
  type: 'relation',
  id: 1234567,
  center: { lat: 12.9, lon: 77.6 },
  tags: { amenity: 'restaurant', name: 'Big Food Hall', cuisine: 'indian' },
}

const unnamed: OverpassElement = {
  type: 'node',
  id: 99,
  lat: 12.9,
  lon: 77.6,
  tags: { amenity: 'cinema' },
}

describe('overpass normalisation', () => {
  it('reads a node coordinate directly', () => {
    const v = toVenue(node)!
    expect(v.id).toBe('node/1459472858')
    expect(v.name).toBe('PVR')
    expect(v.place).toMatchObject({ lat: 12.9346877, lng: 77.6116748, source: 'overpass' })
    expect(v.osm_url).toBe('https://www.openstreetmap.org/node/1459472858')
  })

  it('reads a way coordinate from `center`', () => {
    const v = toVenue(way)!
    expect(v.id).toBe('way/133179621')
    expect(v.place.lat).toBe(12.9318731)
    expect(v.place.lng).toBe(77.6076887)
    expect(v.osm_url).toBe('https://www.openstreetmap.org/way/133179621')
  })

  it('reads a relation coordinate from `center`', () => {
    const v = toVenue(relation)!
    expect(v.id).toBe('relation/1234567')
    expect(v.place.lat).toBe(12.9)
    expect(v.cuisine).toBe('indian')
  })

  it('drops unnamed elements — a group cannot meet at one', () => {
    expect(toVenue(unnamed)).toBeNull()
  })

  it('drops elements with no coordinate at all', () => {
    expect(toVenue({ type: 'way', id: 7, tags: { name: 'Nowhere' } })).toBeNull()
    expect(toVenue({ type: 'node', id: 8, lat: 12.9, tags: { name: 'Half' } })).toBeNull()
  })

  it('drops out-of-range coordinates', () => {
    expect(toVenue({ type: 'node', id: 9, lat: 991, lon: 0, tags: { name: 'Bad' } })).toBeNull()
  })

  it('lifts contact tags and keeps the raw tag bag', () => {
    const v = toVenue(node)!
    expect(v.website).toBe('https://example.test/pvr')
    expect(v.phone).toBe('+91 80 1234 5678')
    expect(v.opening_hours).toBe('Mo-Su 10:00-23:30')
    expect(v.tags.screen).toBe('12')
  })

  it('falls back to contact:* forms', () => {
    const v = toVenue({
      type: 'node',
      id: 10,
      lat: 1,
      lon: 1,
      tags: { name: 'X', 'contact:website': 'https://x.test', 'contact:phone': '+1 555' },
    })!
    expect(v.website).toBe('https://x.test')
    expect(v.phone).toBe('+1 555')
  })

  it('normalises a mixed element list and dedupes by id', () => {
    const venues = normalise([node, way, relation, unnamed, node])
    expect(venues.map((v) => v.id)).toEqual(['node/1459472858', 'way/133179621', 'relation/1234567'])
  })
})

// ---------------------------------------------------------------------------
// Address composition
// ---------------------------------------------------------------------------

describe('composeAddress', () => {
  it('joins housenumber and street in postal order', () => {
    expect(
      composeAddress({
        'addr:housenumber': '221B',
        'addr:street': 'Baker Street',
        'addr:city': 'London',
        'addr:postcode': 'NW1 6XE',
        'addr:country': 'GB',
      }),
    ).toBe('221B Baker Street, London, NW1 6XE, GB')
  })

  it('uses housename when there is no street', () => {
    expect(composeAddress({ 'addr:housename': 'Forum Mall', 'addr:city': 'Bangalore' })).toBe(
      'Forum Mall, Bangalore',
    )
  })

  it('prefers street over housename when both exist', () => {
    expect(composeAddress({ 'addr:housename': 'Forum Mall', 'addr:street': 'Hosur Road' })).toBe('Hosur Road')
  })

  it('falls back from suburb to neighbourhood', () => {
    expect(composeAddress({ 'addr:neighbourhood': 'Koramangala', 'addr:city': 'Bangalore' })).toBe(
      'Koramangala, Bangalore',
    )
  })

  it('is undefined when OSM has no address at all', () => {
    expect(composeAddress({ amenity: 'cinema', name: 'PVR' })).toBeUndefined()
    expect(composeAddress({ 'addr:street': '   ' })).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Query construction — the contract with Overpass
// ---------------------------------------------------------------------------

describe('buildQuery', () => {
  const center = { lat: 12.9352, lng: 77.6245 }

  it('emits a union of nwr clauses with the required header and out statement', () => {
    const q = buildQuery({
      center,
      radius_m: 8000,
      limit: 30,
      filters: [
        { key: 'amenity', value: 'bar' },
        { key: 'amenity', value: 'pub' },
      ],
    })
    expect(q.startsWith('[out:json][timeout:15];')).toBe(true)
    expect(q).toContain('nwr(around:8000,12.9352000,77.6245000)["amenity"="bar"];')
    expect(q).toContain('nwr(around:8000,12.9352000,77.6245000)["amenity"="pub"];')
    expect(q.trimEnd().endsWith('out tags center 30;')).toBe(true)
  })

  it('emits a key-presence selector when the filter has no value', () => {
    const q = buildQuery({ center, radius_m: 500, filters: [{ key: 'shop' }] })
    expect(q).toContain('["shop"];')
  })

  it('appends `also` tags to the same clause', () => {
    const q = buildQuery({
      center,
      radius_m: 500,
      filters: [{ key: 'amenity', value: 'bar', also: { karaoke: 'yes' } }],
    })
    expect(q).toContain('["amenity"="bar"]["karaoke"="yes"];')
  })

  it('escapes regex and quote metacharacters in a name match', () => {
    const q = buildQuery({
      center,
      radius_m: 500,
      filters: [{ key: 'amenity', nameMatch: 'joe"s (bar)' }],
    })
    // Overpass unescapes the string first, so the regex engine sees \( and \).
    expect(q).toContain(String.raw`["name"~"joe\"s \\(bar\\)",i]`)
  })

  it('rounds the radius and never emits exponent notation', () => {
    const q = buildQuery({ center: { lat: 1e-7, lng: 0 }, radius_m: 1234.6, filters: [{ key: 'amenity' }] })
    expect(q).toContain('nwr(around:1235,0.0000001,0.0000000)')
    expect(q).not.toMatch(/e-\d/)
  })

  it('produces nothing to send when there are no filters', () => {
    expect(buildQuery({ center, radius_m: 500, filters: [] })).toContain('(\n\n)')
  })
})

// ---------------------------------------------------------------------------
// Taxonomy
// ---------------------------------------------------------------------------

/**
 * Every tag the taxonomy is allowed to emit, checked by hand against the OSM
 * wiki. A tag that is not on this list is a guess, and a guessed tag looks
 * exactly like "nothing near you" at runtime — so it fails here instead.
 */
const VERIFIED_TAGS = new Set([
  'amenity=cinema',
  'amenity=restaurant',
  'amenity=food_court',
  'amenity=cafe',
  'amenity=bar',
  'amenity=pub',
  'amenity=biergarten',
  'amenity=fast_food',
  'amenity=ice_cream',
  'amenity=nightclub',
  'amenity=karaoke_box',
  'amenity=theatre',
  'amenity=music_venue',
  'amenity=events_venue',
  'amenity=casino',
  'amenity=library',
  'leisure=dance',
  'leisure=bowling_alley',
  'leisure=amusement_arcade',
  'leisure=adult_gaming_centre',
  'leisure=escape_game',
  'leisure=park',
  'leisure=garden',
  'leisure=fitness_centre',
  'leisure=sports_centre',
  'leisure=water_park',
  'tourism=museum',
  'tourism=gallery',
  'tourism=hotel',
  'tourism=hostel',
  'tourism=guest_house',
  'tourism=motel',
  'tourism=theme_park',
  'tourism=zoo',
  'tourism=aquarium',
])

describe('taxonomy', () => {
  it.each([
    ['a cinema', 'cinema', 'amenity=cinema'],
    ['movie night', 'cinema', 'amenity=cinema'],
    ['catch a film', 'cinema', 'amenity=cinema'],
    ['movie theater', 'cinema', 'amenity=cinema'],
    ['dinner on saturday', 'restaurant', 'amenity=restaurant'],
    ['somewhere to eat out', 'restaurant', 'amenity=restaurant'],
    ['food', 'restaurant', 'amenity=restaurant'],
    // The seven meal/drink words a live seeding run was told to check by hand
    // after "Sunday brunch" fell all the way through to a name search — every
    // one of these must resolve to a real category, never a guess.
    ['sunday brunch', 'restaurant', 'amenity=restaurant'],
    ['lunch tomorrow', 'restaurant', 'amenity=restaurant'],
    ['breakfast', 'restaurant', 'amenity=restaurant'],
    ['dessert after dinner', 'ice_cream', 'amenity=ice_cream'],
    ['coffee', 'cafe', 'amenity=cafe'],
    ['a café', 'cafe', 'amenity=cafe'],
    ['drinks after work', 'bar', 'amenity=bar'],
    ['pub', 'bar', 'amenity=bar'],
    ['fast food', 'fast_food', 'amenity=fast_food'],
    ['nightclub', 'nightclub', 'amenity=nightclub'],
    ['bowling', 'bowling', 'leisure=bowling_alley'],
    ['see a play at the theatre', 'theatre', 'amenity=theatre'],
    ['a concert', 'music_venue', 'amenity=music_venue'],
    ['live music', 'music_venue', 'amenity=music_venue'],
    ['hotel', 'hotel', 'tourism=hotel'],
    ['park', 'park', 'leisure=park'],
    ['gym', 'gym', 'leisure=fitness_centre'],
    ['museum', 'museum', 'tourism=museum'],
    ['arcade', 'arcade', 'leisure=amusement_arcade'],
    ['karaoke', 'karaoke', 'amenity=karaoke_box'],
  ])('resolves %j to %s', (text, id, primary) => {
    const hit = resolveCategory(text)!
    expect(hit.id).toBe(id)
    const first = hit.filters[0]!
    expect(`${first.key}=${first.value}`).toBe(primary)
  })

  it('keeps "movie theatre" out of the live-theatre bucket', () => {
    expect(resolveCategory('movie theatre')!.id).toBe('cinema')
    expect(resolveCategory('theatre')!.id).toBe('theatre')
  })

  it('matches whole phrases, not substrings of words', () => {
    // "bar" must not fire on "barbershop"
    expect(resolveCategory('barbershop')).toBeNull()
  })

  it('accepts a canonical id round-tripped through persisted slots', () => {
    expect(resolveCategory('fast_food')!.id).toBe('fast_food')
    expect(resolveCategory('music_venue')!.id).toBe('music_venue')
  })

  it('returns null for something it does not know', () => {
    expect(resolveCategory('quantum blacksmithing')).toBeNull()
    expect(resolveCategory('   ')).toBeNull()
  })

  it('falls back to a name search across amenity, shop and leisure', () => {
    const filters = nameSearchFilters('Quantum Blacksmithing')
    expect(filters.map((f) => f.key)).toEqual(['amenity', 'shop', 'leisure'])
    expect(filters.every((f) => f.nameMatch === 'quantum blacksmithing')).toBe(true)
    expect(filters.every((f) => f.value === undefined)).toBe(true)
  })

  it('categoryFilters never comes back empty-handed', () => {
    expect(categoryFilters('cinema').filters).toHaveLength(1)
    expect(categoryFilters('quantum blacksmithing').filters).toHaveLength(3)
  })

  // A live seeding run had the model emit `category: "venue"` for "Sunday
  // brunch" — a generic word, not a real category. Because the name-search
  // fallback matches venue NAMES by substring, "venue" matched every OSM
  // element whose name merely contains "Avenue": the ranked board offered a
  // police station and a car dealership as brunch venues. This is the one
  // place in the whole taxonomy where "return something" would have been a
  // lie dressed up as a match.
  describe('refuses to guess from a word that names no category at all', () => {
    it.each([
      'venue', 'venues', 'place', 'places', 'spot', 'spots',
      'somewhere', 'anywhere', 'thing', 'things', 'hangout',
    ])('nameSearchFilters(%j) is empty, not a name search', (word) => {
      expect(nameSearchFilters(word)).toEqual([])
    })

    it('is case- and whitespace-insensitive, like every other match in this file', () => {
      expect(nameSearchFilters('Venue')).toEqual([])
      expect(nameSearchFilters('  venues  ')).toEqual([])
    })

    it('categoryFilters comes back with nothing to search — not a coincidental name match', () => {
      const hit = categoryFilters('venue')
      expect(hit.filters).toEqual([])
    })

    it('the same "venue" text end to end: no category, no filters, honest reason', async () => {
      const res = await new Places().search({ near: { lat: 12.9352, lng: 77.6245 }, category: 'venue' })
      expect(res.venues).toEqual([])
      expect(res.category).toBeNull()
      expect(res.reason).toBe('no category to search for')
    })

    it('does not suppress a real query that merely CONTAINS a generic word', () => {
      // "The Venue" as an actual specific phrase (e.g. a venue literally named
      // that, or a longer sentence) must still search by name — only an EXACT
      // generic word is refused, never a substring of one.
      expect(nameSearchFilters('the venue downtown')).not.toEqual([])
      expect(nameSearchFilters('event space')).not.toEqual([])
    })
  })

  it('only emits OSM tags that were checked against the wiki', () => {
    const emitted = CATEGORIES.flatMap((c) => c.filters).map((f) => `${f.key}=${f.value}`)
    expect(emitted.filter((t) => !VERIFIED_TAGS.has(t))).toEqual([])
  })

  it('every category id is unique', () => {
    const ids = CATEGORIES.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

// ---------------------------------------------------------------------------
// Distance
// ---------------------------------------------------------------------------

describe('distance', () => {
  it('measures a known separation within a percent', () => {
    // Koramangala → Indiranagar, Bangalore: ~5.3km
    const d = distanceM({ lat: 12.9352, lng: 77.6245 }, { lat: 12.9784, lng: 77.6408 })
    expect(d).toBeGreaterThan(4800)
    expect(d).toBeLessThan(5800)
  })

  it('is zero for the same point', () => {
    expect(distanceM({ lat: 12.9, lng: 77.6 }, { lat: 12.9, lng: 77.6 })).toBe(0)
  })

  it('ranks venues nearest first', () => {
    const center = { lat: 12.9346877, lng: 77.6116748 }
    const ranked = rankByDistance(normalise([relation, way, node]), center)
    expect(ranked.map((v) => v.id)).toEqual(['node/1459472858', 'way/133179621', 'relation/1234567'])
  })
})

// ---------------------------------------------------------------------------
// Facade — the parts that answer without touching the network
// ---------------------------------------------------------------------------

describe('Places facade', () => {
  it('reports both sources as reachable until something proves otherwise', () => {
    const status = new Places().status()
    expect(status.map((s) => s.kind)).toEqual(['nominatim', 'overpass'])
    expect(status.every((s) => s.available)).toBe(true)
    expect(status.every((s) => s.reason === undefined)).toBe(true)
  })

  it('refuses an empty geocode without going near the network', async () => {
    const res = await new Places().geocode('   ')
    expect(res.places).toEqual([])
    expect(res.reason).toBe('nothing to geocode')
  })

  it('returns a reason rather than throwing when there is nothing to search for', async () => {
    const res = await new Places().search({ near: { lat: 12.9, lng: 77.6 }, category: '   ' })
    expect(res.venues).toEqual([])
    expect(res.category).toBeNull()
    expect(res.reason).toBe('no category to search for')
  })
})
