import Link from 'next/link'
import { Mark } from '@/components/shell'
import { ConsentThreadDemo } from '@/components/landing/consent-thread'
import { BackstopLedger, FrontingFlows } from '@/components/landing/flow'
import { ResolveDemo } from '@/components/landing/resolve'
import './landing.css'

const REPO = 'https://github.com/Soham109/sutra'
const SPEC = `${REPO}/blob/main/spec/PROTOCOL.md`

const POLICIES: { expr: string; means: string }[] = [
  { expr: 'all_of', means: 'Everyone approves, or nobody pays.' },
  { expr: 'quorum(3)', means: 'Any three approvals commit the group. The rest are released uncharged.' },
  { expr: 'weighted(0.60)', means: 'Approvals count for what they carry. Sixty per cent of the cart’s value commits it.' },
  { expr: 'veto(dad, all_of)', means: 'Everyone approves — and one named person can stop the whole thing on their own.' },
  { expr: 'required(treasurer, quorum(3))', means: 'Any three approvals, but the treasurer has to be one of them.' },
  { expr: 'deadline(18:00, all_of, quorum(3))', means: 'Hold out for everyone until 6pm, then fall back to any three.' },
]

const GUARDS: { n: string; title: string; body: string }[] = [
  {
    n: 'card data',
    title: 'The engine never sees a card number.',
    body: 'Mandates and single-use credentials are issued and held by Prava. sutra stores references to them. There is no PAN in our database to leak.',
  },
  {
    n: 'custody',
    title: 'The engine never holds funds.',
    body: 'No balance, no escrow, no pooled account, no float. Money moves from each member’s card to the merchant and never once through us.',
  },
  {
    n: 'enforcement',
    title: 'Caps live at the card network.',
    body: 'A mandate cannot be exercised above its cap or at a different merchant, whatever this app asks for. The limit is not our promise to keep.',
  },
  {
    n: 'failure',
    title: 'Abort charges nobody.',
    body: 'There is nothing to refund because nothing moved — not a partial charge, not a pending hold that clears on Thursday.',
  },
]

export default function Landing() {
  return (
    <div className="landing">
      <header className="l-nav">
        <div className="l-wrap l-nav-in">
          <Link href="/" className="l-brand">
            <Mark />
            sutra
          </Link>
          <nav className="l-nav-links" aria-label="Sections">
            <a href="#how">How it works</a>
            <a href="#policies">Policies</a>
            <a href="#backstop">Backstop</a>
            <a href="#trust">Guarantees</a>
          </nav>
          <div className="l-nav-end">
            <a className="btn btn-ghost l-nav-spec" href={SPEC} target="_blank" rel="noreferrer">
              GMP/1 spec
            </a>
            <Link className="btn btn-primary" href="/app">
              Open the app
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* --- hero ------------------------------------------------------- */}
        <section className="l-wrap l-hero">
          <span className="eyebrow">GMP/1 — the group mandate protocol</span>
          <h1 className="l-h1" style={{ marginTop: 18 }}>
            Every payment system assumes one person is saying yes.
          </h1>
          <p className="l-sub">
            One cart, N people, N cards — each share approved by the person who owes it, capped at the card network,
            and committed in a single window or not at all.
          </p>
          <div className="l-cta-row">
            <Link className="btn btn-primary btn-xl" href="/app">
              Open the app
            </Link>
            <a className="btn btn-secondary btn-xl" href={SPEC} target="_blank" rel="noreferrer">
              Read the GMP/1 spec
            </a>
          </div>
          <p className="guardrail l-hero-guard">
            No pooled funds, no escrow, no treasurer. The engine <b>never sees a card number</b> and{' '}
            <b>never holds a dollar</b>.
          </p>

          <ConsentThreadDemo />
        </section>

        {/* --- the fronting problem --------------------------------------- */}
        <section className="l-band">
          <div className="l-wrap l-section">
            <div className="l-shead">
              <span className="eyebrow">The fronting problem</span>
              <h2 className="l-h2">Someone always ends up being the bank.</h2>
              <p className="l-lede">
                Four friends split a $268.00 cart. One card actually moves. That person is now an unlicensed creditor
                with three unsecured loans out to people they have to keep seeing at dinner. Google AP2, Stripe ACP,
                Visa Intelligent Commerce and Prava all authorise one principal beautifully. None of them can hear a
                group.
              </p>
            </div>

            <FrontingFlows />

            <p className="l-kicker">The second diagram has no dashed lines in it. That is the entire product.</p>
          </div>
        </section>

        {/* --- how it works ------------------------------------------------ */}
        <section id="how" className="l-wrap l-section">
          <div className="l-shead">
            <span className="eyebrow">How it works</span>
            <h2 className="l-h2">Consent first. Money second. Never the other way round.</h2>
            <p className="l-lede">
              The order is the guarantee: nothing is charged until every step before it has already happened, and each
              step can only fail in a way that charges nobody.
            </p>
          </div>

          <ol className="l-steps">
            <li className="l-step">
              <span className="l-step-n">01</span>
              <h3>Each person gets a mandate, not a bill.</h3>
              <p>
                Every member passkey-approves their own Prava mandate on their own device. It is capped at their share,
                locked to that one merchant, single use, and it expires with the group.
              </p>
              <p>
                Those limits are enforced by the card network — not by this app, and not by whoever started the cart.
              </p>
            </li>
            <li className="l-step">
              <span className="l-step-n">02</span>
              <h3>The commit policy decides, not a person.</h3>
              <p>
                The group picks its rule before approvals open: <code className="l-code">all_of</code>,{' '}
                <code className="l-code">quorum(3)</code>,{' '}
                <code className="l-code">required(treasurer, quorum(3))</code>.
              </p>
              <p>
                The engine re-evaluates it the instant each approval or decline lands, and it can only ever reach two
                answers — commit, or abort.
              </p>
            </li>
            <li className="l-step">
              <span className="l-step-n">03</span>
              <h3>One window, or none.</h3>
              <p>
                On commit, every live mandate is exercised into its own single-use credential inside one tight window.
                On abort, every mandate is cancelled where it stands.
              </p>
              <p>There is no state in this protocol where three friends paid and one did not.</p>
            </li>
          </ol>
        </section>

        {/* --- the policy algebra ------------------------------------------ */}
        <section id="policies" className="l-band">
          <div className="l-wrap l-section">
            <div className="l-shead">
              <span className="eyebrow">Commit policy</span>
              <h2 className="l-h2">Group consent is an algebra, not a checkbox.</h2>
              <p className="l-lede">
                Six forms. Three of them take another policy as an argument, so they nest as far as your group is
                complicated.
              </p>
            </div>

            <div className="l-policies">
              <div className="l-prow l-phead">
                <span>expression</span>
                <span>means</span>
              </div>
              {POLICIES.map((p) => (
                <div className="l-prow" key={p.expr}>
                  <code>{p.expr}</code>
                  <p>{p.means}</p>
                </div>
              ))}
            </div>

            <p className="l-kicker">
              <code className="l-code">veto(dad, required(treasurer, quorum(3)))</code> is a legal expression, and the
              engine evaluates it exactly the way it evaluates <code className="l-code">all_of</code>.
            </p>
          </div>
        </section>

        {/* --- backstop ---------------------------------------------------- */}
        <section id="backstop" className="l-band-brand">
          <div className="l-wrap l-section">
            <div className="l-shead">
              <span className="eyebrow">Backstop</span>
              <h2 className="l-h2">The first primitive of group credit that asks nobody to become a lender.</h2>
              <p className="l-lede">
                Before approvals open, any member can arm a backstop: a capped, pre-authorised standing offer to absorb
                up to $75.00 of somebody else’s share if that share drops. So when Cleo declines, the engine does not
                go hunting for a treasurer — it raises Ada’s own mandate to $134.00, on Ada’s own card, under consent
                Ada already gave, and the group commits on schedule. No money is pooled, no balance is held, nobody is
                invoiced afterwards, and every absorbed dollar still moves backstop card → merchant like any other
                charge.
              </p>
            </div>

            <BackstopLedger />

            <div className="l-chips">
              <span className="chip">capped in advance</span>
              <span className="chip">consented in advance</span>
              <span className="chip">never pooled</span>
              <span className="chip">revocable until commit</span>
            </div>
          </div>
        </section>

        {/* --- any merchant ------------------------------------------------ */}
        <section className="l-wrap l-section">
          <div className="l-shead">
            <span className="eyebrow">Any merchant</span>
            <h2 className="l-h2">Paste the link. We read the merchant’s own words.</h2>
            <p className="l-lede">
              No integration on the store’s side. No partnership, no SDK, no checkout plugin, no waiting for a
              marketplace to care about group buying. sutra resolves a product from the structured data the merchant
              already publishes for search engines.
            </p>
          </div>

          <ResolveDemo />

          <p className="l-kicker">
            Price, currency and title come from the store’s own markup. If a page publishes nothing structured, we say
            so instead of guessing at a number people are about to approve.
          </p>
        </section>

        {/* --- guarantees --------------------------------------------------- */}
        <section id="trust" className="l-band">
          <div className="l-wrap l-section">
            <div className="l-shead">
              <span className="eyebrow">What the engine cannot do</span>
              <h2 className="l-h2">The guarantees are structural, not promises.</h2>
              <p className="l-lede">
                Trust in a payments product should not rest on our good intentions. These hold because of where the
                money and the card data are — which is nowhere near us.
              </p>
            </div>

            <div className="l-trust">
              {GUARDS.map((g) => (
                <div className="card l-guard" key={g.n}>
                  <span className="l-guard-n">{g.n}</span>
                  <h3>{g.title}</h3>
                  <p>{g.body}</p>
                </div>
              ))}
            </div>

            <div className="l-proof">
              <div className="card l-guard">
                <span className="l-guard-n">receipts</span>
                <h3>Verify it without asking us anything.</h3>
                <p>
                  Every decision — invite, approval, decline, backstop, charge, abort — is a hash-chained consent
                  object signed with Ed25519. The receipt verifies offline, against the spec, on a laptop with no
                  network.
                </p>
                <div className="l-term">
                  <div>
                    <span className="l-prompt">$</span> gmp verify receipt.json
                  </div>
                  <div>
                    <span className="l-key">chain     </span> 12 links · <span className="l-good">intact</span>
                  </div>
                  <div>
                    <span className="l-key">signature </span> ed25519 · <span className="l-good">valid</span>
                  </div>
                  <div>
                    <span className="l-key">outcome   </span> committed · $268.00 · 3 cards
                  </div>
                </div>
              </div>

              <div className="card l-guard">
                <span className="l-guard-n">chaos</span>
                <h3>Proved by breaking it on purpose.</h3>
                <p>
                  <span className="amount amount-lg" style={{ color: 'var(--brand)' }}>
                    120
                  </span>{' '}
                  randomized fault-injection runs — members dropping mid-flow, mandates timing out, the network
                  partitioning halfway through a commit, webhooks arriving twice.
                </p>
                <p style={{ marginTop: 10 }}>
                  Zero double charges. Every aborted run charged nobody.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* --- final call --------------------------------------------------- */}
        <section className="l-wrap" style={{ paddingBlock: 'clamp(48px, 6vw, 76px)' }}>
          <div className="l-final">
            <div>
              <h2>Start a group. Watch the abort path.</h2>
              <p>
                It runs on sandbox cards, so the money is fake and the protocol is not. The run worth seeing is the one
                where somebody says no.
              </p>
            </div>
            <Link className="btn btn-primary btn-xl" href="/app">
              Open the app
            </Link>
          </div>
        </section>
      </main>

      <footer className="l-footer">
        <div className="l-wrap">
          <div className="l-foot-grid">
            <div>
              <Link href="/" className="l-brand">
                <Mark />
                sutra
              </Link>
              <p className="l-foot-note">
                The multi-principal layer for payments. Built on Prava mandates, speaking GMP/1 — a protocol, not a
                platform. The spec is in the repo and anyone can implement it.
              </p>
            </div>

            <div>
              <div className="l-foot-h">Protocol</div>
              <div className="l-foot-links">
                <a href={SPEC} target="_blank" rel="noreferrer">
                  GMP/1 specification
                </a>
                <a href={REPO} target="_blank" rel="noreferrer">
                  Source on GitHub
                </a>
                <a href="#policies">Commit policy algebra</a>
                <a href="#backstop">Backstops</a>
              </div>
            </div>

            <div>
              <div className="l-foot-h">Product</div>
              <div className="l-foot-links">
                <Link href="/app">Open the app</Link>
                <Link href="/app/discover">Paste a product link</Link>
                <a href="#how">How it works</a>
                <a href="#trust">Guarantees</a>
              </div>
            </div>
          </div>

          <div className="l-foot-bottom">
            <span>Card data and funds stay with Prava. sutra holds references and receipts.</span>
            <span className="mono">gmp/1 · sandbox</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
