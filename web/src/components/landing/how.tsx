import { Reveal } from './reveal'

// What this actually does, said the way a person would say it.
//
// The rest of the page can talk about mandates and rails. This one section has
// a single job: somebody who has never heard of us reads it in fifteen seconds
// and can explain the product to a friend. No protocol vocabulary, no acronyms,
// no "leverage". Every line is a thing that happens, in the order it happens.

const STEPS = [
  {
    n: '1',
    title: 'Tell Sutra bot what you want',
    body:
      '“Dinner Saturday with Arsh and Maya near Koramangala, under ₹800 each.” It works out who you mean, roughly when, and what you can spend.',
    aside: 'Or paste a link. Or photograph a receipt.',
  },
  {
    n: '2',
    title: 'Your friends answer on their phones',
    body:
      'Each of them gets their own link — no account, no download. They tap when they are free, where they are coming from, and their own limit.',
    aside: 'Their budget is never shown to the group.',
  },
  {
    n: '3',
    title: 'It finds places that actually work',
    body:
      'Real venues from OpenStreetMap, ranked on everyone’s answers — who can make the time, how far each person travels, what fits every budget. It shows you the arithmetic.',
    aside: 'Nothing is invented. You can check every number.',
  },
  {
    n: '4',
    title: 'Everyone pays their own share',
    body:
      'Each person approves their own amount on their own card, capped at their own number. Everybody is charged in one go — or nobody is, and every approval is released.',
    aside: 'Nobody fronts the money. Nobody chases anybody.',
  },
]

export function HowItWorks() {
  return (
    <section id="how" className="l-wrap l-section l-how">
      <header className="l-section-head l-section-head-wide">
        <span className="l-section-no">HOW IT WORKS</span>
        <h2>
          One person plans it.
          <br />
          Nobody becomes the bank.
        </h2>
        <p>
          The awkward part of doing anything as a group is not the booking. It is one friend paying
          for everyone and then spending a fortnight asking for it back.
        </p>
      </header>

      <ol className="how-steps">
        {STEPS.map((s, i) => (
          <Reveal as="li" key={s.n} delay={i * 90}>
            <span className="how-n">{s.n}</span>
            <div>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
              <span className="how-aside">{s.aside}</span>
            </div>
          </Reveal>
        ))}
      </ol>

      <p className="how-foot">
        <b>The honest bit:</b> when the merchant can take card payments through our rail, everyone is
        charged directly and no money is ever pooled. When it is a restaurant bill, Sutra does the
        exact split and records who agreed to what — and says plainly that nothing was charged,
        because nothing was.
      </p>
    </section>
  )
}
