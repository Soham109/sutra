import { CATEGORIES } from '../places/taxonomy.js'

// Where a language model earns its place in this system, and where it does not.
//
// It does NOT find venues. OpenStreetMap does that, from real coordinates that
// exist right now. A model asked for "a good bar in Koramangala" would recall
// one from training data, which is the confident fabrication this whole design
// refuses.
//
// What it is good at is the one thing our keyword table cannot do: reading an
// intent nobody phrased in our vocabulary. "Somewhere to watch the match",
// "a place to hang after exams", "chai and gossip" — all of these map cleanly
// onto a category we already support, and none of them contain a keyword we
// index. So the model's entire job here is to pick one of 21 ids we defined.
//
// It is constrained to that enum, so the worst it can do is pick the wrong
// existing category — which shows up as an obviously wrong list of real places,
// not as an invented one. It receives no coordinates, payment credentials or
// ranking inputs, and never influences how real places are ordered.

const CACHE = new Map<string, string>()
const CACHE_MAX = 500
const IDS = CATEGORIES.map((category) => category.id)

/** The ids the model is allowed to answer with. Nothing else is accepted. */
function allowedIds(): string[] {
  return IDS
}

const TOOL = {
  type: 'function' as const,
  function: {
    name: 'pick_category',
    description: 'Choose the single best matching place category, or none.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        category: {
          type: 'string',
          enum: [...IDS, 'none'],
          description: 'One of the allowed ids, or the literal string "none" if nothing fits.',
        },
      },
      required: ['category'],
    },
  },
}

/**
 * Free text → one of our known category ids, or null.
 *
 * Returns null on: no key, a network failure, a model outage, or an answer
 * outside the enum. Every one of those is a normal state — the caller falls
 * back to a name search, which is what happens today without a key at all.
 */
export async function classifyCategory(text: string): Promise<string | null> {
  const query = text.trim().slice(0, 300)
  if (!query) return null

  const cacheKey = query.toLowerCase()
  if (CACHE.has(cacheKey)) return CACHE.get(cacheKey) ?? null

  const key = process.env.OPENAI_API_KEY
  if (!key) return null

  const ids = allowedIds()
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? 'gpt-4.1-nano',
        temperature: 0,
        tools: [TOOL],
        tool_choice: { type: 'function', function: { name: 'pick_category' } },
        messages: [
          {
            role: 'system',
            content:
              'You map a description of something a group of friends wants to do onto exactly one ' +
              `category id from this list: ${ids.join(', ')}. ` +
              'Answer "none" if the request is not about going somewhere — for example if it is ' +
              'about buying an object, or is too vague to place. ' +
              'Never invent an id that is not in the list.',
          },
          { role: 'user', content: query },
        ],
      }),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null

    const data = (await res.json()) as {
      choices: { message: { tool_calls?: { function: { arguments: string } }[] } }[]
    }
    const args = data.choices[0]?.message?.tool_calls?.[0]?.function?.arguments
    if (!args) return null

    const picked = (JSON.parse(args) as { category?: string }).category?.trim().toLowerCase()
    // The enum is enforced here, not trusted from the model.
    if (!picked || picked === 'none' || !ids.includes(picked)) return null
    return remember(cacheKey, picked)
  } catch {
    // A temporary provider or parsing failure must not poison this query for
    // the lifetime of the process. Deterministic discovery continues now and
    // a later request may retry the optional classification.
    return null
  }
}

function remember(key: string, value: string): string {
  // A plan re-searches whenever someone's location moves the centroid, and the
  // intent text never changes between those runs — so this is the difference
  // between one model call per plan and one per answer.
  if (CACHE.size >= CACHE_MAX) CACHE.clear()
  CACHE.set(key, value)
  return value
}
