'use client'

import Link from 'next/link'
import { Mark, ThemeToggle } from '@/components/shell'
import { ErrorNote, Skeleton } from '@/components/ui'

/**
 * The approval page carries no dashboard chrome, so it also can't lean on the
 * dashboard's layout classes. Everything it needs beyond the design tokens
 * lives here, scoped to `.ap-`, and is loaded only on this route.
 */
const CSS = `
.ap-root { min-height: 100dvh; display: flex; flex-direction: column; background: var(--paper); }
.ap-bar {
  position: sticky; top: 0; z-index: 30;
  display: flex; align-items: center; gap: 9px;
  padding: 10px 15px; border-bottom: 1px solid var(--line);
  background: color-mix(in srgb, var(--paper) 84%, transparent);
  backdrop-filter: saturate(180%) blur(12px);
}
.ap-wrap { width: 100%; max-width: 460px; margin: 0 auto; padding: 16px 16px 6px; flex: 1; }
.ap-dock {
  position: sticky; bottom: 0; z-index: 20;
  width: 100%; max-width: 460px; margin: 0 auto;
  padding: 14px 16px calc(14px + env(safe-area-inset-bottom));
  background: linear-gradient(to top, var(--paper) 62%, transparent);
}
.ap-dock .btn-xl { min-height: 56px; font-size: 16.5px; }

.ap-title { font-size: 19px; font-weight: 620; letter-spacing: -0.02em; line-height: 1.2; }
.ap-hero { text-align: center; padding: 22px 18px 18px; }
.ap-hero .amount-xl { font-size: clamp(40px, 13.5vw, 54px); display: block; }
.ap-strike { text-decoration: line-through; color: var(--ink-3); }

.ap-items { margin-top: 14px; border-top: 1px solid var(--line); }
.ap-item {
  display: flex; align-items: baseline; justify-content: space-between; gap: 14px;
  padding: 9px 0; border-bottom: 1px dashed var(--line); font-size: 14px; text-align: left;
}
.ap-item:last-child { border-bottom: 0; }

.ap-faces { display: flex; gap: 14px; overflow-x: auto; padding: 2px 0 4px; scrollbar-width: none; }
.ap-faces::-webkit-scrollbar { display: none; }
.ap-face { display: flex; flex-direction: column; align-items: center; gap: 5px; min-width: 58px; }
.ap-face .ap-ring {
  padding: 2px; border-radius: var(--r-full); background: var(--paper);
  border: 2px solid var(--line-2); transition: border-color 0.3s ease, transform 0.3s cubic-bezier(0.22,1,0.36,1);
}
.ap-face[data-state='approved'] .ap-ring, .ap-face[data-state='charging'] .ap-ring { border-color: var(--brand); }
.ap-face[data-state='charged'] .ap-ring { border-color: var(--ok); transform: scale(1.06); }
.ap-face[data-state='awaiting_approval'] .ap-ring, .ap-face[data-state='viewed'] .ap-ring { border-color: var(--warn-line); }
.ap-face[data-state='declined'] .ap-ring, .ap-face[data-state='dropped'] .ap-ring,
.ap-face[data-state='expired'] .ap-ring, .ap-face[data-state='failed'] .ap-ring { border-color: var(--bad-line); }
.ap-face[data-state='declined'] .avatar, .ap-face[data-state='dropped'] .avatar,
.ap-face[data-state='expired'] .avatar, .ap-face[data-state='failed'] .avatar { filter: grayscale(1); opacity: 0.45; }
.ap-face .ap-nm { font-size: 11.5px; max-width: 62px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink-2); }
.ap-face .ap-nm.is-you { color: var(--ink); font-weight: 650; }

.ap-flip { animation: ap-in 0.34s cubic-bezier(0.22, 1, 0.36, 1); }
@keyframes ap-in { from { opacity: 0; transform: translateY(9px) scale(0.985); } }

.ap-ticket {
  position: relative; background: var(--surface);
  border: 1px solid var(--ok-line); border-radius: var(--r-lg); box-shadow: var(--shadow-2);
}
.ap-ticket-top { padding: 26px 20px 22px; text-align: center; background: var(--ok-soft); border-radius: 15px 15px 0 0; }
.ap-perf { position: relative; border-top: 2px dashed var(--ok-line); }
.ap-perf::before, .ap-perf::after {
  content: ''; position: absolute; top: -11px; width: 20px; height: 20px;
  border-radius: 50%; background: var(--paper); border: 1px solid var(--ok-line);
}
.ap-perf::before { left: -11px; }
.ap-perf::after { right: -11px; }
.ap-ticket-bottom { padding: 16px 20px 18px; }
.ap-stub { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 5px 0; font-size: 13px; }
.ap-stub .k { color: var(--ink-3); }

.ap-abort { border-width: 2px; }
.ap-shout { font-family: var(--font-mono); font-size: 19px; font-weight: 600; letter-spacing: 0.02em; line-height: 1.25; }

.ap-bidrow { display: flex; gap: 8px; align-items: stretch; }
.ap-bidrow .input { flex: 1; }

@media (max-width: 380px) {
  .ap-wrap, .ap-dock { padding-left: 12px; padding-right: 12px; }
}
`

export function ApproveStyles() {
  return <style dangerouslySetInnerHTML={{ __html: CSS }} />
}

export function ApproveFrame({
  children,
  dock,
  live,
}: {
  children: React.ReactNode
  dock?: React.ReactNode
  live?: 'on' | 'off' | null
}) {
  return (
    <>
      <ApproveStyles />
      <div className="ap-root">
        <header className="ap-bar">
          <Link href="/" className="row" style={{ gap: 8 }} aria-label="sutra">
            <Mark />
            <span style={{ fontWeight: 650, letterSpacing: '-0.02em', fontSize: 15 }}>sutra</span>
          </Link>
          <span className="grow" />
          {live && (
            <span className="row tiny faint" style={{ gap: 6 }} title={live === 'on' ? 'Live' : 'Reconnecting'}>
              <span className={live === 'on' ? 'dot dot-brand dot-live' : 'dot'} />
              {live === 'on' ? 'Live' : 'Reconnecting'}
            </span>
          )}
          <ThemeToggle />
        </header>

        <main className="ap-wrap">{children}</main>
        {dock ? <div className="ap-dock">{dock}</div> : null}
      </div>
    </>
  )
}

export function ApproveSkeleton() {
  return (
    <div className="stack" style={{ ['--gap' as string]: '14px' }}>
      <Skeleton h={13} w="45%" />
      <Skeleton h={24} w="80%" />
      <div className="card card-pad col" style={{ gap: 14, alignItems: 'center' }}>
        <Skeleton h={12} w="34%" />
        <Skeleton h={48} w="62%" />
        <Skeleton h={12} w="46%" />
        <Skeleton h={1} />
        <Skeleton h={38} />
      </div>
      <Skeleton h={64} />
      <p className="tiny faint" style={{ textAlign: 'center' }}>
        Opening your share and preparing your mandate…
      </p>
    </div>
  )
}

/** A bad link has to explain itself. It is somebody's money on the line. */
export function BadLink({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="stack" style={{ ['--gap' as string]: '14px', marginTop: 24 }}>
      <h2>We can&apos;t open this share</h2>
      <ErrorNote>{message}</ErrorNote>
      <button className="btn btn-primary btn-block btn-lg" onClick={onRetry}>
        Try again
      </button>
      <p className="small muted">
        Approval links are personal: each one opens one member&apos;s share and nothing else. If a friend forwarded
        you theirs, ask them to send you the group&apos;s join link instead.
      </p>
    </div>
  )
}
