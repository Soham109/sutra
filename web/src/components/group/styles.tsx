'use client'

// Styles that belong to the group surfaces only. globals.css is owned by the
// design system and by another agent, so anything specific to the war room
// lives here, prefixed gr- so it can never collide with a token class.

const CSS = `
.gr-head { display: flex; align-items: flex-start; gap: 18px; flex-wrap: wrap; }
.gr-head-main { flex: 1 1 280px; min-width: 0; }
.gr-head-side { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
@media (max-width: 560px) { .gr-head-side { align-items: flex-start; } }

.gr-grid { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr); gap: 16px; align-items: start; }
@media (max-width: 1000px) { .gr-grid { grid-template-columns: minmax(0, 1fr); } }

.gr-sec { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--line); }

/* --- groups list ---------------------------------------------------------- */

/* Doubled class so this always beats .list-row's flex, whatever the sheet order. */
.gr-row.gr-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 14px; align-items: center; }
.gr-row-meta { display: flex; align-items: center; justify-content: flex-end; gap: 14px; flex-wrap: wrap; }
@media (max-width: 680px) {
  .gr-row.gr-row { grid-template-columns: auto minmax(0, 1fr); }
  .gr-row > .gr-row-meta { grid-column: 1 / -1; justify-content: flex-start; gap: 10px; }
}

.gr-stack { display: flex; flex: none; }
.gr-stack .gr-node { margin-left: -9px; border-radius: var(--r-full); padding: 2px; background: var(--surface); }
.gr-stack .gr-node:first-child { margin-left: 0; }
.gr-node { box-shadow: 0 0 0 2px var(--line-2); }
.gr-node[data-tone='ok'] { box-shadow: 0 0 0 2px var(--ok); }
.gr-node[data-tone='brand'] { box-shadow: 0 0 0 2px var(--brand); }
.gr-node[data-tone='warn'] { box-shadow: 0 0 0 2px var(--warn-line); }
.gr-node[data-tone='bad'] { box-shadow: 0 0 0 2px var(--bad-line); }
.gr-node[data-tone='bad'] .avatar { filter: grayscale(1); opacity: 0.5; }
.gr-more { display: grid; place-items: center; width: 24px; height: 24px; border-radius: var(--r-full); background: var(--surface-2); color: var(--ink-3); font-family: var(--font-mono); font-size: 10.5px; margin-left: -9px; box-shadow: 0 0 0 2px var(--line-2); }

/* --- event log ------------------------------------------------------------ */

.gr-log { max-height: 520px; overflow-y: auto; overscroll-behavior: contain; }
.gr-log-row { display: grid; grid-template-columns: 54px 152px minmax(0, 1fr); gap: 10px; align-items: baseline; padding: 8px 16px; border-top: 1px solid var(--line); }
.gr-log-row:first-child { border-top: 0; }
.gr-log-row:hover { background: var(--surface-2); }
.gr-log-row[data-now='1'] { background: var(--brand-soft); }
.gr-log-time { font-family: var(--font-mono); font-size: 11.5px; color: var(--ink-3); font-variant-numeric: tabular-nums; }
.gr-log-say { font-size: 13.5px; line-height: 1.55; color: var(--ink-2); }
.gr-log-say .mono { color: var(--ink); font-size: 12.5px; }
.gr-log-say .amount { color: var(--ink); }
.gr-tagcell .badge { text-transform: none; letter-spacing: 0; font-size: 11px; }
.gr-log-in { animation: gr-in 0.26s cubic-bezier(0.22, 1, 0.36, 1); }
@keyframes gr-in { from { opacity: 0; transform: translateY(5px); } }
@media (max-width: 620px) {
  .gr-log-row { grid-template-columns: 48px minmax(0, 1fr); gap: 8px; }
  .gr-log-row > .gr-log-say { grid-column: 2; }
}

/* --- replay --------------------------------------------------------------- */

.gr-replay { display: flex; align-items: center; gap: 10px; padding: 10px 16px; border-top: 1px solid var(--line); background: var(--surface-2); flex-wrap: wrap; }
.gr-scrub { flex: 1 1 180px; min-width: 120px; accent-color: var(--brand); height: 20px; cursor: pointer; }
.gr-step { padding: 4px 9px; font-family: var(--font-mono); font-size: 12px; }

/* --- backstop moment ------------------------------------------------------ */

.gr-flow { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 14px; align-items: center; }
@media (max-width: 560px) { .gr-flow { grid-template-columns: minmax(0, 1fr); } }
.gr-flow-track { position: relative; height: 40px; }
.gr-flow-track::before {
  content: ''; position: absolute; left: 0; right: 0; top: 19px; height: 2px;
  background: repeating-linear-gradient(90deg, var(--ok-line) 0 7px, transparent 7px 14px);
}
.gr-flow-token {
  position: absolute; top: 4px; left: 0; white-space: nowrap;
  padding: 4px 10px; border-radius: var(--r-full);
  background: var(--ok-soft); border: 1px solid var(--ok-line); color: var(--ok);
  font-family: var(--font-mono); font-size: 12.5px; font-weight: 550;
  animation: gr-travel 1.45s cubic-bezier(0.5, 0, 0.2, 1) forwards;
}
@keyframes gr-travel {
  from { left: 0; transform: translateX(0); opacity: 0; }
  14% { opacity: 1; }
  to { left: 100%; transform: translateX(-100%); opacity: 1; }
}
.gr-flow-target { border-radius: var(--r); padding: 8px 12px; animation: gr-land 0.7s 1.15s both; }
@keyframes gr-land {
  0% { box-shadow: 0 0 0 0 transparent; }
  45% { box-shadow: 0 0 0 9px var(--ok-soft); }
  100% { box-shadow: 0 0 0 0 transparent; }
}
@media (prefers-reduced-motion: reduce) {
  .gr-flow-token { left: auto; right: 0; animation: none; }
  .gr-flow-target { animation: none; box-shadow: 0 0 0 2px var(--ok-line); }
}

/* The synchronised flip: everyone lands at once, and it must be felt. */
.gr-flip { animation: gr-flip 0.26s cubic-bezier(0.22, 1, 0.36, 1); }
@keyframes gr-flip { 40% { transform: scale(1.008); } }

/* --- members -------------------------------------------------------------- */

.gr-mem { padding: 13px 16px; border-top: 1px solid var(--line); }
.gr-mem:first-child { border-top: 0; }
.gr-mem-head { display: flex; align-items: center; gap: 11px; }
.gr-mem-facts { display: flex; align-items: center; gap: 8px 14px; flex-wrap: wrap; margin-top: 8px; padding-left: 43px; }
@media (max-width: 420px) { .gr-mem-facts { padding-left: 0; } }
.gr-fact { font-size: 12px; color: var(--ink-3); }
.gr-fact b { font-family: var(--font-mono); font-weight: 500; color: var(--ink-2); font-variant-numeric: tabular-nums; }
.gr-qr { width: 152px; height: 152px; background: #fff; border: 1px solid var(--line); border-radius: var(--r); padding: 6px; }

/* --- auction -------------------------------------------------------------- */

.gr-rank { display: flex; align-items: center; gap: 10px; padding: 7px 0; border-top: 1px solid var(--line); }
.gr-rank:first-child { border-top: 0; }
.gr-seal { display: grid; place-items: center; width: 100%; padding: 18px; border: 1px dashed var(--line-2); border-radius: var(--r); background: var(--surface-2); text-align: center; }

/* --- misc ----------------------------------------------------------------- */

.gr-line { display: flex; align-items: baseline; justify-content: space-between; gap: 6px 12px; padding: 5px 0; font-size: 13px; flex-wrap: wrap; overflow-wrap: anywhere; }
.gr-line + .gr-line { border-top: 1px solid var(--line); }
.gr-break { overflow-wrap: anywhere; }
`

/** Injected once per page. Kept out of globals.css, which this agent does not own. */
export function GroupStyles() {
  return <style data-sutra="group" dangerouslySetInnerHTML={{ __html: CSS }} />
}
