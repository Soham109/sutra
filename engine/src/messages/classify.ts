import type { Intent } from './bot.js'

// ---------------------------------------------------------------------------
// Where a model earns a place in @sutra's routing, and where it categorically
// does not (see bot.ts's module doc for the "no invented facts" guarantee
// this file has to preserve). Same shape as agent/classify.ts's category
// picker, and for the same reason: the model is handed a CLOSED list and
// asked to point at one entry, nothing else.
//
// "who still hasn't paid me?" and "can we push it to Sunday?" match none of
// bot.ts's keyword regexes, so they fell through to the help message — which
// reads as broken, because the bot plainly could have answered "who" and
// "when" if only it had understood the words. This is that understanding
// step, and nothing more: it has no access to plan or group state, no access
// to money, and its answer is re-validated against the fixed intent list
// before anything downstream ever sees it. The worst a bad answer can do is
// route to the wrong REAL composer in bot.ts (e.g. show the cart when "who's
// in" was meant) — it can never fabricate a sentence, a number or a name,
// because nothing past this function ever reads the model's own words again.
// ---------------------------------------------------------------------------

/**
 * 'help' is deliberately absent from both lists: it is what "nothing fits"
 * already means (classifyIntent's own fallback), so the model expresses that
 * with the literal "none" the tool schema offers, not by being handed 'help'
 * as if it were a real destination to aim for.
 *
 * 'payment' IS offered, on purpose, to both scopes. The deterministic
 * isPaymentRequest() phrase list already runs before this function is ever
 * called (classifyIntentSmart, bot.ts) — so a message that already matched
 * never reaches here. What can reach here is a payment-shaped sentence that
 * phrased it a way the fixed list did not anticipate ("would you mind
 * sorting my part out tonight"). Letting the model land on 'payment' answers
 * that with the same hardcoded PAYMENT_REFUSAL every other payment intent
 * gets — a strictly SAFER outcome than the alternative of it guessing
 * 'budget' and answering a money question with the wrong money question.
 *
 * 'refresh' is plan-only, matching classifyIntent's own scope gate: a group
 * has nothing left to search for, so the model is never even offered the
 * option of routing there for a group message.
 */
const PLAN_INTENTS: Intent[] = ['payment', 'refresh', 'who', 'when', 'options', 'budget']
const GROUP_INTENTS: Intent[] = ['payment', 'who', 'when', 'options', 'budget']

function allowedFor(scope: 'plan' | 'group'): Intent[] {
  return scope === 'plan' ? PLAN_INTENTS : GROUP_INTENTS
}

function toolFor(allowed: Intent[]) {
  return {
    type: 'function' as const,
    function: {
      name: 'classify_message',
      description: 'Route one chat message to exactly one existing coordination intent, or none.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          intent: {
            type: 'string',
            enum: [...allowed, 'none'],
            description: 'One of the allowed intents, or the literal string "none" if nothing fits.',
          },
        },
        required: ['intent'],
      },
    },
  }
}

/**
 * Free text → one of the bot's existing intents, or null.
 *
 * Returns null on: no key, empty text, a network failure, a model outage, or
 * an answer outside the enum — every one of those degrades to exactly the
 * same 'help' reply the deterministic path already gives on its own (see
 * classifyIntentSmart in bot.ts). This function never returns anything a
 * person will read directly: its entire output space is a handful of labels,
 * enforced HERE rather than trusted from the model's own text — same
 * discipline as classifyCategory in agent/classify.ts.
 */
export async function classifyIntentWithOpenAI(text: string, scope: 'plan' | 'group'): Promise<Intent | null> {
  const query = text.trim().slice(0, 500)
  if (!query) return null
  const key = process.env.OPENAI_API_KEY
  if (!key) return null

  const allowed = allowedFor(scope)
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? 'gpt-4.1-nano',
        temperature: 0,
        tools: [toolFor(allowed)],
        tool_choice: { type: 'function', function: { name: 'classify_message' } },
        messages: [
          {
            role: 'system',
            content:
              'A message in a group-coordination chat matched no known keyword. Read it and route it to ' +
              `exactly one of these intents: ${allowed.join(', ')}. ` +
              '"who" is about attendance, RSVPs or approval/payment status. "when" is about timing or the ' +
              'deadline. "options" is about venues, products or what is in the cart. "budget" is about cost ' +
              'or a spending limit. ' +
              (allowed.includes('refresh')
                ? '"refresh" is an explicit instruction to search again for options. '
                : '') +
              '"payment" is any instruction or request — however indirect — to pay, charge, approve, settle ' +
              'or accept money. Answer "none" if nothing fits. You are a router, not a writer: nobody reads ' +
              'what you say here, only the single label you pick.',
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

    const picked = (JSON.parse(args) as { intent?: string }).intent?.trim().toLowerCase()
    // The enum is enforced here, not trusted from the model — an invented
    // label ("maybe_budget"), a stray sentence, or literal "none" all fall
    // through to the same null a missing key already produces.
    if (!picked || picked === 'none' || !(allowed as string[]).includes(picked)) return null
    return picked as Intent
  } catch {
    // A model outage must never be the reason @sutra stops answering a
    // question it already knew how to compose a real answer to — the caller
    // falls back to 'help', exactly as if no key were configured at all.
    return null
  }
}
