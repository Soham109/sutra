// The wire shape of one chat line. Deliberately not a database row: a message
// IS an event (`message.posted`) on whichever log already exists for its
// scope — plan_events for a plan, events for a group — so it inherits replay,
// ordering and SSE delivery for free instead of needing a transport of its own.

/** What the append endpoint accepts. Nothing else is settable by a caller. */
export interface PostMessageInput {
  text: string
}

export interface MessagePayload {
  message_id: string
  from: 'user' | 'bot'
  /** null for the bot, and for nothing else — posting requires a signed-in account. */
  author_user_id: string | null
  author_name: string
  text: string
  mentions_sutra: boolean
  /**
   * Which of the tagger's standing-rule fields this reply drew on, e.g.
   * ['budget_ceiling_minor']. Set only on a bot reply, and only when it is
   * true — the whole point is that the UI can show a disclosure chip without
   * re-parsing prose, and a caller who invents this field invents a lie about
   * where the answer came from.
   */
  used_rules?: string[]
}

export interface MessageView extends MessagePayload {
  seq: number
  created_at: string
}
