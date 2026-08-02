import { describe, expect, it } from 'vitest'
import { isPlaceholderName } from '../src/agent/extract.js'

// The model inventing people, and a real human being shown the invention as
// their own name.
//
// "dinner saturday with two friends near koramangala under 800 each" came back
// from the extractor as people: ["friend1","friend2"] — twice, from the same
// sentence, despite the tool schema saying "Do not invent names" in those exact
// words. Those two placeholders became real plan participants, then real group
// members, and then somebody opened their own approval link and read, on the
// page this codebase calls "the only page most people will ever see of sutra":
//
//     You are friend1.
//
// The deterministic extractor never does this — it requires a capitalised
// token, so "two friends" correctly yields nobody. These tests pin the filter
// that makes the model agree, and pin the other edge too: refusing real names
// would be its own bug, and plenty of real people are called Guest.

describe('names a model made up to fill a headcount', () => {
  it('drops the numbered stand-ins', () => {
    for (const n of [
      'friend1', 'friend 1', 'Friend 2', 'FRIEND3', 'friend #4',
      'person2', 'Person 1', 'guest1', 'Guest 2', 'attendee 04',
      'participant 1', 'member2', 'user 3', 'buddy1', 'mate 2',
    ]) {
      expect(isPlaceholderName(n), n).toBe(true)
    }
  })

  it('drops the bare generics', () => {
    for (const n of ['friend', 'Friends', 'person', 'People', 'someone', 'Somebody', 'other', 'others', 'unknown', 'TBD', 'anon', 'placeholder', 'name']) {
      expect(isPlaceholderName(n), n).toBe(true)
    }
  })

  it('drops a count that was never a name', () => {
    for (const n of ['two friends', '3 people', 'four guests', 'a friend', 'the others']) {
      expect(isPlaceholderName(n), n).toBe(true)
    }
  })

  it('never drops an actual person', () => {
    for (const n of [
      'Arsh', 'Maya', 'Soham', 'Priya', 'Ada Okonkwo', 'Jean-Luc', "O'Brien",
      // Guest and Friend are real surnames, and refusing them would be this
      // same bug pointed the other way. A second word is what distinguishes
      // them: nobody writes "dinner with Guest", but "Mr Guest" is a person.
      'Mr Guest', 'Sarah Friend', 'Amy Person', 'Yuki', 'Zhang Wei',
      // A single letter is a plausible nickname, not a placeholder.
      'J', 'Bo',
    ]) {
      expect(isPlaceholderName(n), n).toBe(false)
    }
  })

  /**
   * The deliberate cost of the rule above. A lone "Guest" is treated as the
   * model filling a gap, because in this product's input — a sentence somebody
   * typed about dinner — it overwhelmingly is. Somebody genuinely called Guest
   * with no first name given is dropped from the extraction, which is visible
   * and correctable on the confirm screen. The other direction is not: it puts
   * a fabricated name in front of a stranger as their own.
   */
  it('accepts that a lone generic surname is treated as a placeholder', () => {
    expect(isPlaceholderName('Guest')).toBe(true)
    expect(isPlaceholderName('Friend')).toBe(true)
  })

  it('treats blank as nothing at all', () => {
    expect(isPlaceholderName('')).toBe(true)
    expect(isPlaceholderName('   ')).toBe(true)
  })
})
