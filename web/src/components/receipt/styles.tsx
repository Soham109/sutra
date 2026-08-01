'use client'

/**
 * Receipt-only styling, scoped to `.rc-`. Judges keep artifacts, so the print
 * rules are part of the design and not an afterthought: on paper the chain
 * shows full hashes, drops every control, and never breaks an entry across
 * pages.
 */
const CSS = `
.rc-chain { list-style: none; padding: 0; margin: 0; }
.rc-entry { position: relative; padding: 0 0 18px 30px; }
.rc-entry::before {
  content: ''; position: absolute; left: 9px; top: 6px; bottom: -6px;
  width: 2px; background: var(--line-2);
}
.rc-entry:last-child::before { display: none; }
.rc-node {
  position: absolute; left: 2px; top: 4px; width: 16px; height: 16px;
  border-radius: 50%; background: var(--paper); border: 2px solid var(--brand); z-index: 1;
}
.rc-entry[data-kind='backstop'] .rc-node { border-color: var(--warn); border-style: dashed; }
.rc-entry[data-charged='no'] .rc-node { border-color: var(--line-2); }

.rc-card { border: 1px solid var(--line); border-radius: var(--r); background: var(--surface); padding: 13px 15px; }
.rc-entry[data-kind='backstop'] .rc-card { border-color: var(--warn-line); background: var(--warn-soft); }

.rc-grid { display: grid; grid-template-columns: 118px 1fr; gap: 3px 14px; font-size: 13px; margin-top: 10px; }
.rc-grid dt { color: var(--ink-3); }
.rc-grid dd { margin: 0; overflow-wrap: anywhere; }

.rc-link {
  display: flex; flex-wrap: wrap; align-items: center; gap: 7px;
  margin-top: 11px; padding-top: 10px; border-top: 1px dashed var(--line);
  font-family: var(--font-mono); font-size: 11.5px; color: var(--ink-2); overflow-wrap: anywhere;
}
.rc-link .lbl { color: var(--ink-3); }
.rc-link .arrow { color: var(--brand); font-weight: 600; }

.rc-head {
  display: inline-flex; align-items: center; gap: 8px;
  border: 1px solid var(--brand-line); background: var(--brand-soft); color: var(--brand-ink);
  border-radius: var(--r-sm); padding: 6px 10px; font-family: var(--font-mono); font-size: 12px;
  overflow-wrap: anywhere;
}

.rc-code {
  background: var(--surface-2); border: 1px solid var(--line); border-radius: var(--r);
  padding: 12px 14px; font-family: var(--font-mono); font-size: 12.5px; line-height: 1.75;
  white-space: pre-wrap; overflow-wrap: anywhere; user-select: all; color: var(--ink);
}
.rc-key { font-family: var(--font-mono); font-size: 12px; overflow-wrap: anywhere; color: var(--ink-2); }
.rc-full { display: none; }

.rc-totals { display: grid; grid-template-columns: 1fr auto; gap: 8px 16px; align-items: baseline; }

@media (max-width: 520px) {
  .rc-grid { grid-template-columns: 1fr; gap: 0; }
  .rc-grid dt { margin-top: 7px; font-size: 11.5px; }
}

@media print {
  .rc-noprint { display: none !important; }
  .rc-full { display: inline; }
  .rc-short { display: none; }
  .rc-entry, .rc-card { break-inside: avoid; }
  .rc-code, .rc-card, .rc-head { background: #fff !important; }
  .rc-entry::before { background: #bbb; }
  .rc-node { border-color: #444 !important; }
  a[href^='http']::after { content: ' (' attr(href) ')'; font-size: 10px; color: #555; }
}
`

export function ReceiptStyles() {
  return <style dangerouslySetInnerHTML={{ __html: CSS }} />
}
