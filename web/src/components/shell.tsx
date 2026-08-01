'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Avatar, Modal } from './ui'
import { useSession } from './session'

const NAV = [
  { section: null, items: [
    { href: '/app', label: 'Home', icon: 'home' },
    { href: '/app/discover', label: 'Discover', icon: 'search' },
    { href: '/app/groups', label: 'Groups', icon: 'thread' },
  ] },
  { section: 'People', items: [
    { href: '/app/people', label: 'People', icon: 'people' },
    { href: '/app/circles', label: 'Circles', icon: 'circle' },
  ] },
  { section: 'Records', items: [
    { href: '/app/receipts', label: 'Receipts', icon: 'receipt' },
    { href: '/app/settings', label: 'Settings', icon: 'gear' },
  ] },
]

export function Shell({ children, crumbs }: { children: React.ReactNode; crumbs?: React.ReactNode }) {
  const { user, loading } = useSession()
  const [paletteOpen, setPaletteOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!loading && !user) return <SignIn />

  return (
    <div className="shell">
      <Sidebar />
      <div className="col grow" style={{ minWidth: 0 }}>
        <header className="topbar">
          <div className="crumbs grow">{crumbs ?? <span className="here">Home</span>}</div>
          <button className="btn btn-secondary" onClick={() => setPaletteOpen(true)}>
            <Icon name="search" /> Search <span className="kbd">⌘K</span>
          </button>
          <ThemeToggle />
        </header>
        <main className="grow">{children}</main>
      </div>
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
    </div>
  )
}

function Sidebar() {
  const path = usePathname()
  const { user, signOut } = useSession()

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <Link href="/app" className="row" style={{ gap: 9, padding: '4px 6px' }}>
          <Mark />
          <span style={{ fontWeight: 650, letterSpacing: '-0.02em', fontSize: 16 }}>sutra</span>
        </Link>
      </div>

      <nav className="sidebar-nav">
        {NAV.map((group, gi) => (
          <div key={gi} className={group.section ? 'nav-section' : undefined}>
            {group.section && <div className="nav-section-label">{group.section}</div>}
            {group.items.map((item) => {
              const active = item.href === '/app' ? path === '/app' : path.startsWith(item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="nav-item"
                  aria-current={active ? 'page' : undefined}
                >
                  <Icon name={item.icon} />
                  {item.label}
                </Link>
              )
            })}
          </div>
        ))}

        <div className="nav-section">
          <Link href="/app/discover" className="btn btn-primary btn-block" style={{ marginTop: 4 }}>
            Start a group buy
          </Link>
        </div>
      </nav>

      <div className="sidebar-foot">
        {user && (
          <div className="row" style={{ gap: 9 }}>
            <Avatar name={user.name} color={user.accent} size="sm" />
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="small" style={{ fontWeight: 550, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {user.name}
              </div>
              <div className="tiny faint mono">@{user.handle}</div>
            </div>
            <button className="btn btn-ghost tiny" onClick={() => void signOut()} title="Sign out">
              ⏻
            </button>
          </div>
        )}
      </div>
    </aside>
  )
}

function SignIn() {
  const { signIn } = useSession()
  const [handle, setHandle] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!handle.trim()) return
    setBusy(true)
    setError('')
    try {
      await signIn(handle.trim(), name.trim() || undefined)
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 20 }}>
      <div className="card card-pad" style={{ width: '100%', maxWidth: 400 }}>
        <div className="row" style={{ gap: 9, marginBottom: 16 }}>
          <Mark />
          <span style={{ fontWeight: 650, fontSize: 17, letterSpacing: '-0.02em' }}>sutra</span>
        </div>
        <h2 style={{ marginBottom: 4 }}>Pick a handle</h2>
        <p className="small muted" style={{ marginBottom: 16 }}>
          It only labels you inside the app. Paying still needs your own passkey on your own device.
        </p>
        <form onSubmit={submit} className="stack" style={{ ['--gap' as string]: '12px' }}>
          <label className="field">
            <span className="field-label">Handle</span>
            <input
              className="input"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="soham"
              autoFocus
              maxLength={30}
            />
          </label>
          <label className="field">
            <span className="field-label">Display name (optional)</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Soham" />
          </label>
          {error && <p className="small" style={{ color: 'var(--bad)' }}>{error}</p>}
          <button className="btn btn-primary btn-block btn-lg" disabled={busy || !handle.trim()}>
            {busy ? 'Setting up…' : 'Continue'}
          </button>
        </form>
        <p className="tiny faint" style={{ marginTop: 14 }}>
          <Link href="/" style={{ color: 'var(--brand)' }}>← Back to the homepage</Link>
        </p>
      </div>
    </div>
  )
}

function CommandPalette({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const [q, setQ] = useState('')

  const actions = [
    { label: 'Find something to buy', hint: 'Search or paste any product link', href: '/app/discover' },
    { label: 'Your groups', hint: 'Live and finished', href: '/app/groups' },
    { label: 'People', hint: 'Friends and reliability records', href: '/app/people' },
    { label: 'Circles', hint: 'Groups you keep re-forming', href: '/app/circles' },
    { label: 'Receipts', hint: 'Signed consent chains', href: '/app/receipts' },
    { label: 'Settings', hint: 'Theme, identity, engine', href: '/app/settings' },
  ].filter((a) => !q || a.label.toLowerCase().includes(q.toLowerCase()) || a.hint.toLowerCase().includes(q.toLowerCase()))

  const go = (href: string) => {
    onClose()
    router.push(href)
  }

  return (
    <Modal title="Go to" onClose={onClose}>
      <input
        className="input input-lg"
        placeholder="Type a page, or paste a product link…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            if (/^https?:\/\//i.test(q)) go(`/app/discover?url=${encodeURIComponent(q)}`)
            else if (actions[0]) go(actions[0].href)
          }
        }}
        autoFocus
      />
      <div style={{ marginTop: 12 }}>
        {actions.map((a) => (
          <button key={a.href} className="list-row" style={{ width: '100%', textAlign: 'left', background: 'none', border: 0, borderBottom: '1px solid var(--line)', cursor: 'pointer' }} onClick={() => go(a.href)}>
            <div className="grow">
              <div style={{ fontWeight: 550 }}>{a.label}</div>
              <div className="tiny faint">{a.hint}</div>
            </div>
            <span className="faint">↵</span>
          </button>
        ))}
        {actions.length === 0 && /^https?:\/\//i.test(q) && (
          <button className="btn btn-primary btn-block" onClick={() => go(`/app/discover?url=${encodeURIComponent(q)}`)}>
            Resolve this link
          </button>
        )}
      </div>
    </Modal>
  )
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  useEffect(() => {
    setTheme((document.documentElement.dataset.theme as 'light' | 'dark') ?? 'light')
  }, [])
  const flip = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    localStorage.setItem('sutra-theme', next)
    setTheme(next)
  }
  return (
    <button className="btn btn-ghost" onClick={flip} aria-label="Toggle theme" title="Toggle theme">
      {theme === 'dark' ? '☀' : '☾'}
    </button>
  )
}

export function Mark() {
  // The thread: separate nodes, one line through them.
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
      <path d="M2 11h18" stroke="var(--brand)" strokeWidth="1.75" strokeLinecap="round" />
      <circle cx="4.5" cy="11" r="2.6" fill="var(--brand)" />
      <circle cx="11" cy="11" r="2.6" fill="var(--paper)" stroke="var(--brand)" strokeWidth="1.75" />
      <circle cx="17.5" cy="11" r="2.6" fill="var(--brand)" />
    </svg>
  )
}

export function Icon({ name }: { name: string }) {
  const common = { width: 15, height: 15, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true } as const
  const s = { stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (name) {
    case 'home':
      return <svg {...common}><path d="M2.5 6.8 8 2.5l5.5 4.3V13a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5V6.8Z" {...s} /></svg>
    case 'search':
      return <svg {...common}><circle cx="7.2" cy="7.2" r="4.2" {...s} /><path d="m10.4 10.4 3 3" {...s} /></svg>
    case 'thread':
      return <svg {...common}><path d="M2 8h12" {...s} /><circle cx="3.6" cy="8" r="1.8" fill="currentColor" /><circle cx="8" cy="8" r="1.8" {...s} /><circle cx="12.4" cy="8" r="1.8" fill="currentColor" /></svg>
    case 'people':
      return <svg {...common}><circle cx="6" cy="6" r="2.4" {...s} /><path d="M2 13c0-2.2 1.8-3.5 4-3.5s4 1.3 4 3.5" {...s} /><path d="M11 4.2a2.4 2.4 0 0 1 0 4.2M12 13c0-1.6-.6-2.6-1.6-3.2" {...s} /></svg>
    case 'circle':
      return <svg {...common}><circle cx="8" cy="8" r="5.5" {...s} /><circle cx="8" cy="8" r="2" fill="currentColor" /></svg>
    case 'receipt':
      return <svg {...common}><path d="M4 2.5h8v11l-2-1-2 1-2-1-2 1v-11Z" {...s} /><path d="M6.5 6h3M6.5 8.5h3" {...s} /></svg>
    case 'gear':
      return <svg {...common}><circle cx="8" cy="8" r="2.2" {...s} /><path d="M8 1.8v1.6M8 12.6v1.6M14.2 8h-1.6M3.4 8H1.8M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1M12.4 12.4l-1.1-1.1M4.7 4.7 3.6 3.6" {...s} /></svg>
    default:
      return null
  }
}
