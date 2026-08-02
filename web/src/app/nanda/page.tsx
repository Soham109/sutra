import Link from 'next/link'
import type { Metadata } from 'next'
import { Mark } from '@/components/shell'
import { DiscoveryChain } from './DiscoveryChain'
import { CopyButton } from './CopyButton'
import { Transcript } from './Transcript'
import {
  SCENE_COMMAND,
  SCENE_TRANSCRIPT,
  BASELINE_COMMAND,
  BASELINE_TRANSCRIPT,
  TEST_COMMAND,
  TEST_SUMMARY,
  PLUGINS_COMMAND,
  PLUGINS_OUTPUT,
  SETUP_COMMAND,
} from './scene-data'
import './nanda.css'

const REPO = 'https://github.com/Soham109/sutra'
const RUN_COMMAND = `cd nanda-town-prava\n${SETUP_COMMAND}\npython scripts/town_scene.py`

export const metadata: Metadata = {
  title: 'sutra — the NANDA Town adapter, checked live',
  description:
    'Four discovery endpoints fetched live, the payments plugin explained in three sentences, and the same group purchase run against prava_mandates and the bundled prepaid_credits, side by side, verbatim.',
}

export default function NandaPage() {
  return (
    <div className="nanda">
      <header className="nanda-nav">
        <Link href="/" className="nanda-nav-brand">
          <Mark />
          <span>sutra</span>
        </Link>
        <span className="nanda-nav-sep">/</span>
        <span className="nanda-nav-title">NANDA evidence</span>
        <Link href="/" className="nanda-nav-back">
          ← back to sutra
        </Link>
      </header>

      <div className="nanda-wrap">
        <section className="nanda-hero">
          <span className="eyebrow">Project NANDA · Best Prava Adapter for the NANDA Town</span>
          <h1 className="display">
            Check it yourself.<br />Ninety seconds.
          </h1>
          <p className="nanda-hero-lede">
            This page makes three separate claims, and none of them ask you to trust sutra: a live
            fetch of the four endpoints below, a real Python plugin registered on{' '}
            <code className="mono">nest.plugins.payments</code>, and the verbatim output of running
            the same group purchase against it and against the plugin Nanda Town ships by default.
            Nothing on this page is staged for the screenshot — every number below either just
            answered from a live request, or is the literal stdout of a script sitting in this
            repository.
          </p>
          <p className="nanda-hero-lede">
            Two different NANDA integrations live in this repo, and they are not the same thing:
            sutra&rsquo;s own agent-discovery documents (§1, below) prove sutra is reachable as an
            agent on the open web; the <code className="mono">prava_mandates</code> plugin (§2–3) is
            the actual payments adapter this track judges. Both are real. Only one is the prize.
          </p>
        </section>

        {/* ---- 1. Discovery chain, live ---------------------------------- */}
        <section className="nanda-section" id="discovery">
          <div className="nanda-section-head">
            <span className="eyebrow">§1 · Discovery, live</span>
            <h2>Four endpoints, fetched by your browser, right now.</h2>
            <p>
              Not a screenshot, not a cached badge — this component calls each URL below the moment
              this page finishes loading, from wherever you are reading it. The thread fills as real
              responses land, the same way sutra&rsquo;s own consent thread fills as real mandates are
              approved: it can only move when something true has happened.
            </p>
          </div>
          <DiscoveryChain />
        </section>

        {/* ---- 2. What the plugin is -------------------------------------- */}
        <section className="nanda-section" id="adapter">
          <div className="nanda-section-head">
            <span className="eyebrow">§2 · The adapter</span>
            <h2>What prava_mandates actually is.</h2>
          </div>

          <div className="nanda-thesis">
            <p>
              <code className="mono">prava_mandates</code> is a real entry point registered under{' '}
              <code className="mono">nest.plugins.payments</code> in{' '}
              <a href={`${REPO}/blob/main/nanda-town-prava/pyproject.toml`}>pyproject.toml</a> — read
              straight off <code className="mono">importlib.metadata</code>, the same call{' '}
              <code className="mono">nest_core.plugins.PluginRegistry</code> makes (Act 0 of the
              transcript below), not a shelled-out CLI. It sits right next to the bundled{' '}
              <code className="mono">prepaid_credits</code> — nothing was removed to add this — and
              the growing test suite in{' '}
              <a href={`${REPO}/blob/main/nanda-town-prava/tests`}>nanda-town-prava/tests/</a> passes
              in full; the exact count as of this writing is in the receipt to the right.
            </p>
            <p>
              It maps <code className="mono">pay()</code> onto a real card-network authorization:
              every call mints a Prava mandate scoped to one merchant, capped at one amount, and
              charged exactly once — never a balance moved inside a simulator. See it in{' '}
              <a href={`${REPO}/blob/main/nanda-town-prava/nanda_town_prava/plugin.py`}>plugin.py</a>.
            </p>
            <p>
              The consequence is structural, not a policy switch that could be flipped back: with this
              plugin installed, <b>one agent cannot pay another agent</b> — there is no rail for it.
              That is tested directly (
              <code className="mono">tests/test_conservation.py::test_no_agent_is_ever_credited_by_another</code>
              ) and demonstrated live, on stage, in Act 6 of the transcript below.
            </p>
          </div>

          <div className="nanda-receipts">
            <div className="card well nanda-receipt">
              <div className="nanda-receipt-head">
                <span>{PLUGINS_COMMAND}</span>
                <CopyButton text={PLUGINS_COMMAND} />
              </div>
              <pre className="mono">{PLUGINS_OUTPUT}</pre>
            </div>
            <div className="card well nanda-receipt">
              <div className="nanda-receipt-head">
                <span>{TEST_COMMAND}</span>
                <CopyButton text={TEST_COMMAND} />
              </div>
              <pre className="mono">{TEST_SUMMARY}</pre>
            </div>
          </div>
        </section>

        {/* ---- 3. The contrast --------------------------------------------- */}
        <section className="nanda-section" id="contrast">
          <div className="nanda-section-head">
            <span className="eyebrow">§3 · The contrast — the prize argument</span>
            <h2>The same $186.00 group purchase, on both plugins.</h2>
            <p>
              Four named town agents — Soham, Arsh, Dev, Maya — attempt one real{' '}
              <code className="mono">pay_group()</code> purchase: a policy of quorum(2 of 3), Dev
              declining mid-flight, Maya&rsquo;s backstop mandate absorbing the shortfall. Then the
              identical purchase is attempted against Nanda Town&rsquo;s bundled{' '}
              <code className="mono">prepaid_credits</code>. Below is the unedited stdout of both
              runs — read it, don&rsquo;t take the tiles&rsquo; word for it.
            </p>
          </div>

          <div className="nanda-stats">
            <div className="card nanda-stat">
              <span className="amount amount-lg nanda-stat-value">$0.00</span>
              <span className="nanda-stat-label">ever pooled inside prava_mandates, this run</span>
              <span className="nanda-stat-who mono">no_pooled_funds: True</span>
            </div>
            <div className="card nanda-stat">
              <span className="amount amount-lg nanda-stat-value">$186.00</span>
              <span className="nanda-stat-label">reached the merchant, despite Dev declining mid-flight</span>
              <span className="nanda-stat-who mono">18600 == 18600</span>
            </div>
            <div className="card nanda-stat">
              <span className="amount amount-lg nanda-stat-value">$186.00</span>
              <span className="nanda-stat-label">pooled inside one agent&rsquo;s own balance instead — by prepaid_credits, before any merchant is paid</span>
              <span className="nanda-stat-who mono">Soham&rsquo;s balance: 0 → 18600</span>
            </div>
            <div className="card nanda-stat">
              <span className="nanda-stat-value is-code">AttributeError</span>
              <span className="nanda-stat-label">what prepaid_credits raises when asked to run a group purchase at all</span>
              <span className="nanda-stat-who mono">no pay_group() method exists</span>
            </div>
          </div>

          <div className="tty-label">
            <div className="tty-label-cmd">
              <span className="small muted mono">{SCENE_COMMAND}</span>
              <CopyButton text={SCENE_COMMAND} />
            </div>
            <span className="tiny faint">nanda-town-prava/scripts/town_scene.py — simulated, zero network, zero keys</span>
          </div>
          <Transcript text={SCENE_TRANSCRIPT} />

          <div className="tty-label" style={{ marginTop: 28 }}>
            <div className="tty-label-cmd">
              <span className="small muted mono">{BASELINE_COMMAND}</span>
              <CopyButton text={BASELINE_COMMAND} />
            </div>
            <span className="tiny faint">the same contrast at marketplace scale — 100 agents, byte-identical traces</span>
          </div>
          <Transcript text={BASELINE_TRANSCRIPT} />
        </section>

        {/* ---- 4. Run it yourself -------------------------------------------- */}
        <section className="nanda-section" id="run">
          <div className="nanda-section-head">
            <span className="eyebrow">§4 · Reproduce it</span>
            <h2>One command. Same repo, your machine.</h2>
            <p>
              Requires Python ≥3.12 (nanda-town-prava/pyproject.toml). No account, no API key, no
              network call — <code className="mono">simulated</code> mode is an in-process GMP/1
              engine that emits the same JSON shapes as the deployed one.
            </p>
          </div>

          <div className="nanda-cmd">
            <code>{RUN_COMMAND}</code>
            <CopyButton text={RUN_COMMAND} className="btn" />
          </div>

          <div className="nanda-cmd-more">
            <div className="nanda-cmd-row">
              <span className="tiny faint" style={{ width: 130, flex: 'none' }}>run the tests</span>
              <code>{TEST_COMMAND}</code>
              <CopyButton text={TEST_COMMAND} />
            </div>
            <div className="nanda-cmd-row">
              <span className="tiny faint" style={{ width: 130, flex: 'none' }}>confirm discovery</span>
              <code>{PLUGINS_COMMAND}</code>
              <CopyButton text={PLUGINS_COMMAND} />
            </div>
            <div className="nanda-cmd-row">
              <span className="tiny faint" style={{ width: 130, flex: 'none' }}>marketplace scale</span>
              <code>{BASELINE_COMMAND}</code>
              <CopyButton text={BASELINE_COMMAND} />
            </div>
          </div>
        </section>

        <footer className="nanda-foot">
          <a href={`${REPO}/blob/main/nanda-town-prava/nanda_town_prava/plugin.py`}>plugin.py</a>
          <a href={`${REPO}/blob/main/nanda-town-prava/scripts/town_scene.py`}>town_scene.py</a>
          <a href={`${REPO}/blob/main/nanda-town-prava/README.md`}>nanda-town-prava/README.md</a>
          <a href={`${REPO}/blob/main/docs/NANDA-EVIDENCE.md`}>docs/NANDA-EVIDENCE.md</a>
          <a href={`${REPO}/blob/main/spec/PROTOCOL.md`}>spec/PROTOCOL.md</a>
        </footer>
      </div>
    </div>
  )
}
