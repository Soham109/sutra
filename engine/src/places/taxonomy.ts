// Free text → OSM tag filters.
//
// Pure data plus a resolver. Every tag below was checked against the OSM wiki
// (Map_features, Key:amenity, Key:leisure, Key:tourism); a guessed tag returns
// zero venues from Overpass and looks exactly like "there is nothing near you",
// which is the worst possible failure mode for a discovery layer.
//
// The vocabulary is deliberately conservative. When we cannot recognise a
// category we say so (`resolveCategory` → null) and the caller falls back to a
// name search, rather than silently ranking the wrong kind of place.

export interface OverpassFilter {
  /** primary tag key, e.g. 'amenity' */
  key: string
  /** exact value; omitted means "key is present", used by the name fallback */
  value?: string
  /** further tags that must also match, e.g. { karaoke: 'yes' } */
  also?: Record<string, string>
  /** case-insensitive substring match against the venue's `name` tag */
  nameMatch?: string
}

export interface Category {
  /** stable id, safe to persist in a plan's slots */
  id: string
  /** what the UI shows: "Cinemas", "Bars & pubs" */
  label: string
  /**
   * Phrases that resolve here. Matched on word boundaries, longest phrase
   * first — that is what keeps "movie theatre" out of the live-theatre bucket.
   */
  synonyms: string[]
  filters: OverpassFilter[]
}

export const CATEGORIES: readonly Category[] = [
  {
    id: 'cinema',
    label: 'Cinemas',
    synonyms: ['movie theatre', 'movie theater', 'cinema', 'cinemas', 'movie', 'movies', 'film', 'films', 'multiplex'],
    filters: [{ key: 'amenity', value: 'cinema' }],
  },
  {
    id: 'restaurant',
    label: 'Restaurants',
    synonyms: [
      'restaurant',
      'restaurants',
      'dinner',
      'dining',
      'lunch',
      'brunch',
      'supper',
      'eat out',
      'eating out',
      'meal',
      'food',
    ],
    // food_court included: in malls and airports it is where a group actually eats.
    filters: [
      { key: 'amenity', value: 'restaurant' },
      { key: 'amenity', value: 'food_court' },
    ],
  },
  {
    id: 'cafe',
    label: 'Cafés',
    synonyms: ['cafe', 'cafes', 'café', 'coffee shop', 'coffeeshop', 'coffee', 'espresso', 'tea', 'catch up'],
    filters: [{ key: 'amenity', value: 'cafe' }],
  },
  {
    id: 'bar',
    label: 'Bars & pubs',
    synonyms: [
      'bar',
      'bars',
      'pub',
      'pubs',
      'drinks',
      'drinking',
      'beer',
      'beers',
      'cocktail',
      'cocktails',
      'tavern',
      'biergarten',
      'beer garden',
      'happy hour',
    ],
    filters: [
      { key: 'amenity', value: 'bar' },
      { key: 'amenity', value: 'pub' },
      { key: 'amenity', value: 'biergarten' },
    ],
  },
  {
    id: 'fast_food',
    label: 'Fast food',
    synonyms: [
      'fast food',
      'fastfood',
      'takeaway',
      'take away',
      'takeout',
      'take out',
      'quick bite',
      'burger',
      'burgers',
      'street food',
    ],
    filters: [{ key: 'amenity', value: 'fast_food' }],
  },
  {
    id: 'ice_cream',
    label: 'Ice cream',
    synonyms: ['ice cream', 'icecream', 'gelato', 'dessert', 'desserts'],
    filters: [{ key: 'amenity', value: 'ice_cream' }],
  },
  {
    id: 'nightclub',
    label: 'Nightclubs',
    synonyms: ['nightclub', 'nightclubs', 'night club', 'clubbing', 'club', 'clubs', 'dancing', 'disco', 'night out'],
    filters: [
      { key: 'amenity', value: 'nightclub' },
      { key: 'leisure', value: 'dance' },
    ],
  },
  {
    id: 'karaoke',
    label: 'Karaoke',
    synonyms: ['karaoke', 'karaoke box', 'karaoke bar', 'singing'],
    // amenity=karaoke_box is the dedicated venue; the wiki's guidance for a bar
    // or pub that merely offers karaoke is the karaoke=yes property, so both.
    filters: [
      { key: 'amenity', value: 'karaoke_box' },
      { key: 'amenity', value: 'bar', also: { karaoke: 'yes' } },
      { key: 'amenity', value: 'pub', also: { karaoke: 'yes' } },
    ],
  },
  {
    id: 'bowling',
    label: 'Bowling',
    synonyms: ['bowling', 'bowling alley', 'ten pin', 'tenpin', 'ten-pin'],
    filters: [{ key: 'leisure', value: 'bowling_alley' }],
  },
  {
    id: 'theatre',
    label: 'Theatres',
    // "theater" lands here, not on cinema: amenity=theatre is live performance,
    // and the US reading of the bare word is captured by "movie theater" above.
    synonyms: ['theatre', 'theater', 'play', 'plays', 'drama', 'musical', 'opera', 'stage show'],
    filters: [{ key: 'amenity', value: 'theatre' }],
  },
  {
    id: 'music_venue',
    label: 'Live music',
    synonyms: ['live music', 'music venue', 'concert', 'concerts', 'gig', 'gigs', 'band', 'show'],
    filters: [
      { key: 'amenity', value: 'music_venue' },
      { key: 'amenity', value: 'events_venue' },
    ],
  },
  {
    id: 'arcade',
    label: 'Arcades',
    synonyms: ['arcade', 'arcades', 'amusement arcade', 'video games', 'gaming', 'pinball', 'game centre', 'game center'],
    filters: [
      { key: 'leisure', value: 'amusement_arcade' },
      { key: 'leisure', value: 'adult_gaming_centre' },
    ],
  },
  {
    id: 'escape_room',
    label: 'Escape rooms',
    synonyms: ['escape room', 'escape rooms', 'escape game'],
    filters: [{ key: 'leisure', value: 'escape_game' }],
  },
  {
    id: 'museum',
    label: 'Museums & galleries',
    synonyms: ['museum', 'museums', 'gallery', 'galleries', 'exhibition', 'exhibit', 'art'],
    filters: [
      { key: 'tourism', value: 'museum' },
      { key: 'tourism', value: 'gallery' },
    ],
  },
  {
    id: 'park',
    label: 'Parks',
    synonyms: ['park', 'parks', 'picnic', 'outdoors', 'green space', 'garden', 'gardens', 'walk', 'stroll'],
    filters: [
      { key: 'leisure', value: 'park' },
      { key: 'leisure', value: 'garden' },
    ],
  },
  {
    id: 'gym',
    label: 'Gyms',
    synonyms: ['gym', 'gyms', 'fitness', 'fitness centre', 'fitness center', 'workout', 'exercise', 'sports centre', 'sports center'],
    filters: [
      { key: 'leisure', value: 'fitness_centre' },
      { key: 'leisure', value: 'sports_centre' },
    ],
  },
  {
    id: 'swimming',
    label: 'Swimming',
    // leisure=swimming_pool is the water surface, not a venue you can meet at,
    // so the filters name the facilities that own one.
    synonyms: ['swimming', 'swim', 'pool', 'water park', 'waterpark'],
    filters: [
      { key: 'leisure', value: 'water_park' },
      { key: 'leisure', value: 'sports_centre', also: { sport: 'swimming' } },
    ],
  },
  {
    id: 'hotel',
    label: 'Hotels',
    synonyms: ['hotel', 'hotels', 'hostel', 'motel', 'guest house', 'guesthouse', 'accommodation', 'lodging', 'stay over', 'overnight'],
    filters: [
      { key: 'tourism', value: 'hotel' },
      { key: 'tourism', value: 'hostel' },
      { key: 'tourism', value: 'guest_house' },
      { key: 'tourism', value: 'motel' },
    ],
  },
  {
    id: 'theme_park',
    label: 'Theme parks & zoos',
    synonyms: ['theme park', 'amusement park', 'zoo', 'aquarium', 'safari'],
    filters: [
      { key: 'tourism', value: 'theme_park' },
      { key: 'tourism', value: 'zoo' },
      { key: 'tourism', value: 'aquarium' },
    ],
  },
  {
    id: 'casino',
    label: 'Casinos',
    synonyms: ['casino', 'casinos', 'gambling', 'poker'],
    filters: [{ key: 'amenity', value: 'casino' }],
  },
  {
    id: 'library',
    label: 'Libraries',
    synonyms: ['library', 'libraries', 'study', 'reading room'],
    filters: [{ key: 'amenity', value: 'library' }],
  },
]

/** Longest phrase first, so a specific match always beats a substring of it. */
const INDEX: readonly { phrase: string; category: Category }[] = CATEGORIES.flatMap((category) =>
  category.synonyms.map((s) => ({ phrase: normalise(s), category })),
)
  .filter((e) => e.phrase.length > 0)
  .sort((a, b) => b.phrase.length - a.phrase.length)

const BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]))

/**
 * Free text → a known category, or null when we do not recognise it. Null is a
 * real answer: the caller falls back to a name search rather than pretending.
 */
export function resolveCategory(text: string): { id: string; label: string; filters: OverpassFilter[] } | null {
  const haystack = ` ${normalise(text)} `
  if (haystack.trim().length === 0) return null

  // An exact category id wins outright — ids round-trip through persisted slots.
  const exact = BY_ID.get(haystack.trim().replace(/ /g, '_'))
  if (exact) return { id: exact.id, label: exact.label, filters: exact.filters }

  for (const { phrase, category } of INDEX) {
    if (haystack.includes(` ${phrase} `)) {
      return { id: category.id, label: category.label, filters: category.filters }
    }
  }
  return null
}

/**
 * The fallback for text we do not recognise: match the words against venue
 * names across the three keys that cover almost everything a group would meet
 * at. Broad on purpose — an unrecognised category should return *something*
 * real rather than an empty board.
 */
export function nameSearchFilters(text: string): OverpassFilter[] {
  const nameMatch = normalise(text).slice(0, 60).trim()
  if (!nameMatch) return []
  return [
    { key: 'amenity', nameMatch },
    { key: 'shop', nameMatch },
    { key: 'leisure', nameMatch },
  ]
}

/** Never null: a recognised category, else the name-match fallback. */
export function categoryFilters(text: string): { id: string; label: string; filters: OverpassFilter[] } {
  const hit = resolveCategory(text)
  if (hit) return hit
  return { id: 'search', label: `“${text.trim()}”`, filters: nameSearchFilters(text) }
}

/** lowercase, unaccented, punctuation → spaces. Matching is phrase-based. */
function normalise(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}
