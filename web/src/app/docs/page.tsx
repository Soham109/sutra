import Link from 'next/link'
import type { Metadata } from 'next'
import { Mark } from '@/components/shell'
import { SystemGlance, GroupLifecycle, CommitSaga, TwoRails, CoordinationLayer, Legend } from './diagrams'
import './docs.css'

const REPO = 'https://github.com/Soham109/sutra'
const FILE = (p: string) => `${REPO}/blob/main/${p}`
const ENGINE = 'https://engine-production-e6fa.up.railway.app'

export const metadata: Metadata = {
  title: 'sutra — architecture',
  description:
    'How sutra actually works: planning, Shopify discovery, explicit merchant capabilities, the GMP/1 state machine, and a signed receipt that always names what actually got paid.',
}

export default function DocsPage() {
  return (
    <div className="docs">
      <header className="docs-nav">
        <Link href="/" className="docs-nav-brand">
          <Mark />
          <span>sutra</span>
        </Link>
        <span className="docs-nav-sep">/</span>
        <span className="docs-nav-title">Architecture</span>
        <Link href="/" className="docs-nav-back">
          ← back to sutra
        </Link>
      </header>

      <div className="docs-wrap">
        {/* ---------------------------------------------------------------- */}
        <section className="docs-hero">
          <span className="eyebrow">Architecture</span>
          <h1 className="display">How sutra actually works.</h1>
          <p className="docs-hero-lede">
            A group plans and agrees one thing together without pooling money. Only a merchant with a real
            payment adapter can turn that agreement into capped charges through Prava, the payment platform
            Sutra is built on. Shopify POS, checkout handoff, and at-venue groups explicitly record zero
            charged by Sutra.
          </p>
          <div className="docs-hero-facts">
            <span className="chip mono">service.ts — the commit saga</span>
            <span className="chip mono">spec/PROTOCOL.md — the spec</span>
            <span className="chip mono">626 tests, 35 files</span>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        <div className="card docs-tldr">
          <p>
            <b>GMP/1 is the protocol:</b> people, one cart, a decision rule, and an all-or-none commit.
            It lives under <code>/v1/groups</code> and <code>/v1/members</code>.
          </p>
          <p>
            <b>Sutra is the product above it:</b> planning, discovery, browser capture, MCP, and NANDA.
            Those surfaces prepare the purchase; only the protocol can commit it.
          </p>
        </div>

        {/* ==================================================================
            1. SYSTEM AT A GLANCE
        ================================================================== */}
        <section className="docs-section" id="system">
          <div className="docs-section-head">
            <span className="eyebrow">§1 · The system at a glance</span>
            <h2>Five doors in, one engine, and an explicit payment boundary.</h2>
            <p>
              A web app, a browser extension, a bookmarklet, an MCP server for agent frameworks, and a Python
              plugin for Project NANDA&rsquo;s town simulator all speak the exact same HTTP contract into the
              same engine. None of that intake traffic touches money. A Prava charge is available only behind a
              supported merchant adapter; a product URL or imported cart never grants that capability.
            </p>
          </div>
          <div className="doc-diagram-row">
            <div className="doc-diagram">
              <SystemGlance />
              <Legend
                items={[
                  { swatch: 'money', label: 'carries money' },
                  { swatch: 'muted', label: 'no money moves' },
                ]}
              />
            </div>
            <div className="doc-prose">
              <p>
                A <b>mandate</b> — the one term on this page worth defining up front — is a permission, not a
                payment: &ldquo;let this one merchant charge this one card up to this one amount, one
                time.&rdquo; Creating a mandate moves no money. The engine asks Prava to create a mandate{' '}
                <b>session</b> (<code>POST /v1/sessions</code>) and hands the member a link to Prava&rsquo;s
                own hosted page. What happens next is the one step in this entire system that no script,
                agent, or plugin can perform: the member opens that page on their own device and approves
                with their own passkey. The engine is not in that loop at all — it finds out later, by asking.
              </p>
              <p>
                Only when the group&rsquo;s rule is satisfied does the engine call{' '}
                <code>POST /v1/mandates/:id/charge</code>. That call is where Prava mints a single-use,
                merchant-locked card credential for a supported adapter. Everything upstream of it
                — discovery, planning, cart-building, reading a page you&rsquo;re on — is free of money by
                construction, not by policy: none of those code paths hold a Prava key capable of a charge.
              </p>
              <p className="tiny faint mono" style={{ marginTop: 4 }}>
                mcp/src/server.ts · extension/content.js · widget/bookmarklet.js · nanda-town-prava/nanda_town_prava/plugin.py
              </p>
            </div>
          </div>
        </section>

        {/* ==================================================================
            2. THE LIFE OF A GROUP
        ================================================================== */}
        <section className="docs-section" id="lifecycle">
          <div className="docs-section-head">
            <span className="eyebrow">§2 · The life of a group</span>
            <h2>The real state machine — every status, every legal move.</h2>
            <p>
              Taken directly from the type declarations (<code>engine/src/types.ts</code>) and the code that
              actually assigns them (<code>engine/src/service.ts</code>), not from a description of either.
              A group and a member each have their own machine; the member machine forks depending on which of
              the selected settlement capability is carrying the group (more on that in §4).
            </p>
          </div>
          <div className="doc-diagram-row">
            <div className="doc-diagram">
              <GroupLifecycle />
            </div>
            <div className="doc-prose">
              <p>
                <b>collecting</b> is where every group starts and where it spends almost all its life: members
                open their link, approve or decline, or simply run out the clock. The type also declares an
                eighth status, <code>draft</code> — it is never assigned anywhere in the code (one grep hit:
                the declaration itself), so it is left off this diagram on purpose. The spec&rsquo;s{' '}
                <code>deciding</code> state is real in the same way: <code>decide()</code> evaluates the
                group&rsquo;s rule and, if it passes, locks the approver set and moves straight to{' '}
                <code>committing</code> in the same synchronous call — no group row is ever observed sitting
                in <code>deciding</code>.
              </p>
              <p>
                <b>committing</b> is deliberately a one-way door: <code>cancelGroup()</code> throws
                &ldquo;cannot cancel past the point of no return&rdquo; the instant a group reaches it, because
                the first charge call is about to fire and a card charge does not have an undo button.
              </p>
              <p>
                On the member side, the dashed amber line is a detail worth having exactly right, because it
                is easy to get backwards: when a price drift pushes someone over their approved cap,{' '}
                <code>requoteCascade()</code> resets them not to &ldquo;awaiting approval&rdquo; but all the
                way back to <b>viewed</b> — because it is <code>openMember()</code>, entered from{' '}
                <code>viewed</code>, that mints the fresh mandate session at the new share. Consent cannot
                silently stretch to cover a higher number; a requote is capped at two rounds, then the group
                aborts rather than asking a third time.
              </p>
            </div>
          </div>
          <figure className="doc-shot">
            <img src="/docs/group-midflight.png" alt="A real sutra group board mid-flight: three members in 'collecting', an event log showing member.invited, fx.snapshot, member.viewed and member.awaiting_acceptance events in order, and a consent thread with each member's node still unfilled." loading="lazy" />
            <figcaption>
              A real group, mid-flight — <code>status: collecting</code>, three members still deciding. The
              event log on the left is the append-only source every one of these states is read back from;
              nothing here is a client-side guess.
            </figcaption>
          </figure>
        </section>

        {/* ==================================================================
            3. THE COMMIT SAGA
        ================================================================== */}
        <section className="docs-section" id="commit">
          <div className="docs-section-head">
            <span className="eyebrow">§3 · The commit saga</span>
            <h2>From &ldquo;the rule passed&rdquo; to a signed receipt.</h2>
            <p>
              A card charge cannot be rolled back, so this is written as a saga, not a transaction: every step
              is idempotent, every attempt is logged before it is retried, and a crash at any point resumes
              from the event log rather than guessing. <code>engine/src/service.ts</code>,{' '}
              <code>runCommit()</code> onward.
            </p>
          </div>
          <div className="doc-diagram-row">
            <div className="doc-diagram">
              <CommitSaga />
            </div>
            <div className="doc-prose">
              <p>
                If the group&rsquo;s locked members can&rsquo;t quite cover the total at their approved caps —
                a straggler dropped out, or price drifted — the shortfall goes to any <b>armed backstop</b>{' '}
                first: someone who pre-authorised a second, separate mandate as a standing offer to cover
                exactly this. Only if no backstop covers it does the group requote. This is the closest thing
                in the system to group credit, and it still never pools a cent — a backstop&rsquo;s money
                moves from their own card, through their own mandate, the same way everyone else&rsquo;s does.
              </p>
              <p>
                The charge call itself has three outcomes, and conflating any two of them is exactly how a
                system double-charges someone or gets stuck forever:
              </p>
              <ul>
                <li>
                  <b>A 4xx response is a definite no.</b> Prava has already told us nothing was charged;
                  retrying it burns time and risks a second definite no reading like doubt.
                </li>
                <li>
                  <b>A transport failure is genuinely unknown</b> — the request may have landed. Before doing
                  anything else, the engine asks Prava&rsquo;s own record of that mandate&rsquo;s charges for
                  the reference it sent. Found it → adopt that transaction id, never reissue. Still not there
                  after retries → the state is recorded as <b>unknown</b>, which is a first-class outcome, not
                  a bug: the group stays in <code>committing</code> and a background poller resumes it later
                  under the exact same idempotency reference.
                </li>
                <li>
                  <b>A success</b> is written to the database as <code>charged</code> before the (slower,
                  separately retried) settlement report is even attempted — because a restart between those
                  two steps used to leave the database saying &ldquo;charging&rdquo; for a card that had
                  already been billed, and the resumed saga would mint a fresh reference and charge it again.
                </li>
              </ul>
              <p>
                At the end, every mandate that was never charged is explicitly cancelled, and the receipt is
                Ed25519-signed and hash-chained (<code>engine/src/receipt.ts</code>) so anyone — a member, a
                judge — can verify it offline against the printed public key, without trusting sutra&rsquo;s
                UI at all.
              </p>
            </div>
          </div>
        </section>

        {/* ==================================================================
            4. SETTLEMENT CAPABILITIES
        ================================================================== */}
        <section className="docs-section" id="rails">
          <div className="docs-section-head">
            <span className="eyebrow">§4 · Settlement capabilities</span>
            <h2>What each outcome may claim — and the rule that catches a lie.</h2>
            <p>
              <code>engine/src/rails.ts</code> — the code calls each of these four settlement paths a{' '}
              <b>rail</b> — separates a true Prava adapter from Shopify POS handoff, online checkout handoff,
              and at-venue agreement. The last three cannot call Prava and are structurally forbidden from
              claiming money moved.
            </p>
          </div>
          <div className="doc-diagram-row">
            <div className="doc-diagram">
              <TwoRails />
            </div>
            <div className="doc-prose">
              <p>
                A URL proves product provenance, never payment capability. Discover requires a person to choose
                Shopify POS or checkout handoff. The extension is always checkout handoff. Venue plans stay plans
                until a real bill exists; a chosen OpenStreetMap point is never treated as a checkout.
              </p>
              <p>
                On the honest rail, a member&rsquo;s consent is a real act with its own HTTP route — not a
                gap: <code>POST /v1/members/:id/accept</code> calls <code>acceptShare()</code>, which is
                deliberately a different act from a passkey mandate so the receipt can never blur the two.
                Reaching <code>committed</code> here means every amount is agreed and recorded; it never means
                a card was touched.
              </p>
              <p>
                The bottom of the diagram is the part worth trusting most: <code>verifyReceipt()</code> is a
                pure function anyone can run offline against a receipt file. It rejects a non-zero charged amount
                on every non-charging capability, including Shopify POS and checkout handoff.
              </p>
            </div>
          </div>
          <figure className="doc-shot">
            <img src="/docs/approval-at-venue.png" alt="A real sutra at_venue approval page showing a member's exact share, the itemised lines it comes from, and the disclosure: 'Nothing is charged through sutra on this split. You are agreeing that ₹426.01 is your share, then paying Toit, Indiranagar directly on your own card.'" loading="lazy" />
            <figcaption>
              A real approval page on the <code>at_venue</code> rail. The disclosure text is not UI copy
              written once and forgotten — it is <code>rails.ts</code>&rsquo;s own string, the same one that
              lands in the receipt.
            </figcaption>
          </figure>

          <div className="doc-note">
            <b>The honest boundary this system draws for itself.</b> Sutra does not place a merchant order for
            a shared cart. Four people means four single-use cards, and a normal checkout has one card field —
            so one cart split four ways only completes automatically where the merchant adapter reconciles those
            payments. Today, Sutra can prepare a confirmed Shopify POS split for a cashier, or return the group
            to online checkout while saying that address, shipping, tax and payment are still pending. See{' '}
            <code>web/src/components/discover/how-it-completes.tsx</code>, which detects and states this
            distinction on every cart rather than papering over it.
          </div>
        </section>

        {/* ==================================================================
            5. THE COORDINATION LAYER
        ================================================================== */}
        <section className="docs-section" id="coordination">
          <div className="docs-section-head">
            <span className="eyebrow">§5 · The coordination layer</span>
            <h2>A sentence, made into a cart — above the protocol, not part of it.</h2>
            <p>
              GMP/1 begins the moment a group already knows what it&rsquo;s buying. Real groups don&rsquo;t
              start there — they start at &ldquo;dinner Saturday?&rdquo; and spend an hour deciding when,
              where, and who can make it. This layer is that hour, made into an object.{' '}
              <code>engine/src/plan/</code>, <code>docs/COORDINATION.md</code>.
            </p>
          </div>
          <div className="doc-diagram-row">
            <div className="doc-diagram">
              <CoordinationLayer />
            </div>
            <div className="doc-prose">
              <p>
                A model may propose the slots (category, timing, place, budget) from free text, but a
                deterministic pass is the floor and always runs underneath it — with no key and no network,
                the same sentence still parses. The model never picks a venue, never sets a price, and never
                invents a coordinate: it reports a place <i>phrase</i>, and a real geocoder (OpenStreetMap
                Nominatim) turns that into an actual location.
              </p>
              <p>
                Ranking is a pure function over real data — five weighted factors (how well the time works,
                how far people travel, whether it fits the budget, group preference, and freshness), and every
                one of them renders as a sentence a person can check by hand against the numbers, not a black
                box score.
              </p>
              <p>
                <code>convertToGroup()</code> is the only door between the two layers, and it only opens one
                way: once a group hands its chosen option through it, the plan is marked{' '}
                <code>converted</code> and the coordination layer never touches that group again. This
                boundary is why an agent that speaks only <code>/v1/groups</code> is a complete GMP/1 client —
                this entire layer, real venues and all, is optional product built on top, not the protocol.
              </p>
            </div>
          </div>
        </section>

        {/* ==================================================================
            VERIFY
        ================================================================== */}
        <section className="docs-section" id="verify">
          <div className="docs-section-head">
            <span className="eyebrow">Verify</span>
            <h2>Don&rsquo;t take this page&rsquo;s word for it.</h2>
            <p>Every command below runs against the live deployment or the repository directly.</p>
          </div>
          <div className="doc-verify-grid">
            <div className="card doc-verify-card">
              <h3>the engine is actually up</h3>
              <pre>curl -s {ENGINE}/health</pre>
              <p>Look at <code>uptime_s</code> — a small number means it was recently deployed, not that it&rsquo;s down.</p>
            </div>
            <div className="card doc-verify-card">
              <h3>the discovery documents are real</h3>
              <pre>curl -s https://sutra-gmp.vercel.app/.well-known/agent-card.json</pre>
              <p>Generated from one endpoint inventory (<code>engine/src/discovery/endpoints.ts</code>), CORS-open, unauthenticated.</p>
            </div>
            <div className="card doc-verify-card">
              <h3>the whole test suite</h3>
              <pre>npm test -w engine</pre>
              <p>626 tests across 35 files, all passing as of 2 Aug 2026 — that number will drift; run it rather than trust it.</p>
            </div>
            <div className="card doc-verify-card">
              <h3>the widget/extension/bookmarklet share one brain</h3>
              <pre>npm run test:widget</pre>
              <p>33 tests, including one asserting all three delivery mechanisms carry byte-identical detection logic.</p>
            </div>
            <div className="card doc-verify-card">
              <h3>a receipt, offline, no server</h3>
              <pre>npx -w cli tsx src/gmp.ts verify receipt.json</pre>
              <p>Recomputes the hash chain, checks totals against entries, verifies the Ed25519 signature. Runs on a laptop with no network.</p>
            </div>
            <div className="card doc-verify-card">
              <h3>the commit saga under fault injection</h3>
              <pre>npm run chaos</pre>
              <p>Random groups, random declines, random 500s and lost responses — then both the event log and the mock ledger are checked: nobody charged twice, every receipt verifies.</p>
            </div>
            <div className="card doc-verify-card">
              <h3>the coordination layer, against real venues</h3>
              <pre>npm run e2e:plan</pre>
              <p>Nothing mocked: real Nominatim geocoding, real Overpass venues, the same ranking code the UI renders.</p>
            </div>
            <div className="card doc-verify-card">
              <h3>a real sandbox charge, passkey and all</h3>
              <pre>npm run e2e:proof -- --watch</pre>
              <p>The one step this page cannot verify for you: it needs a human on a phone. That is the protocol&rsquo;s security property working as designed, not a missing feature.</p>
            </div>
          </div>
        </section>

        {/* ==================================================================
            OPEN / NOT BUILT
        ================================================================== */}
        <section className="docs-section" id="open">
          <div className="docs-section-head">
            <span className="eyebrow">Stated plainly</span>
            <h2>What this page will not round up.</h2>
          </div>
          <div className="docs-gap-list">
            <div className="docs-gap">
              <span className="docs-gap-mark">OPEN</span>
              <p>
                <b>Prava&rsquo;s charge response includes a <code>credentials</code> field — the single-use
                card number itself — and the engine reads past it.</b> Confirmed directly in the API contract
                (<code>openapi.json:988</code>, &ldquo;present for merchant callers: single-use card
                credentials&rdquo;) and in the client: <code>chargeMandate()</code> in{' '}
                <code>engine/src/prava/client.ts</code> types the response as{' '}
                <code>{'{ status, transactionId, errorCode, errorMessage, deduplicated }'}</code> and nothing
                else — the credential Prava mints for each person is minted and then dropped on the floor.
                Wiring it up is a PCI-scope decision, not a UI change, and it has been left alone on purpose
                rather than half-done.
              </p>
            </div>
            <div className="docs-gap">
              <span className="docs-gap-mark">SPLIT TENDER</span>
              <p>
                GMP/1 proposes that a merchant could reconcile the shared idempotency reference every charge
                in a group already carries (<code>gmp:&#123;group&#125;:&#123;member&#125;:&#123;source&#125;:&#123;attempt&#125;</code>)
                to accept several single-use cards against one order. No merchant has implemented that side of
                it. Until one does, a shared cart&rsquo;s money reaches the merchant as several separate,
                real charges that their order system does not know belong together — see the note in §4.
              </p>
            </div>
            <div className="docs-gap">
              <span className="docs-gap-mark">SCOPE</span>
              <p>
                <code>GroupStatus.draft</code> is declared in <code>types.ts</code> and assigned nowhere — a
                vestigial enum member, confirmed by grep, not a bug and not load-bearing for anything on this
                page. Standing rules and recurring/trust-line mandates (L4 in <code>spec/PROTOCOL.md</code>{' '}
                §9) are designed, not implemented. No AP2 mandate is issued or consumed by this code —{' '}
                <code>spec/AP2-EXTENSION.md</code> is a positioning memo, not an integration.
              </p>
            </div>
          </div>
        </section>

        <footer className="docs-foot">
          <Link href="/nanda">NANDA evidence page</Link>
          <a href={FILE('spec/PROTOCOL.md')}>spec/PROTOCOL.md</a>
          <a href={FILE('docs/COORDINATION.md')}>docs/COORDINATION.md</a>
          <a href={FILE('engine/src/service.ts')}>engine/src/service.ts</a>
          <a href={FILE('engine/src/rails.ts')}>engine/src/rails.ts</a>
          <a href={FILE('engine/src/receipt.ts')}>engine/src/receipt.ts</a>
          <a href={FILE('README.md')}>README.md</a>
        </footer>
      </div>
    </div>
  )
}
