'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { MoneyFlow } from '@/components/home/primer'
import { Field, Section } from '@/components/home/section'
import { useSession } from '@/components/session'
import { Shell } from '@/components/shell'
import { Avatar, Badge, ErrorNote, Skeleton } from '@/components/ui'
import { api } from '@/lib/api'
import { disablePush, enablePush, pushPermission, pushSupported } from '@/lib/push'

type ThemeChoice = 'light' | 'dark' | 'system'

const THEME_KEY = 'sutra-theme'
const THEMES: { id: ThemeChoice; label: string; glyph: string }[] = [
  { id: 'light', label: 'Light', glyph: '☀' },
  { id: 'dark', label: 'Dark', glyph: '☾' },
  { id: 'system', label: 'System', glyph: '◐' },
]

interface Source {
  kind: string
  label: string
  available: boolean
  reason?: string
}

export default function SettingsPage() {
  const { user, signOut, loading } = useSession()
  const [theme, setTheme] = useState<ThemeChoice>('system')
  const [sources, setSources] = useState<Source[] | null>(null)
  const [sourceError, setSourceError] = useState('')
  const [signingOut, setSigningOut] = useState(false)
  const [extensionToken, setExtensionToken] = useState('')
  const [extensionStatus, setExtensionStatus] = useState('')
  const [pushBusy, setPushBusy] = useState(false)
  const [pushNote, setPushNote] = useState('')
  const [pushOn, setPushOn] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem(THEME_KEY)
    setTheme(stored === 'light' || stored === 'dark' ? stored : 'system')
    setPushOn(pushPermission() === 'granted')
  }, [])

  const applyTheme = (choice: ThemeChoice) => {
    setTheme(choice)
    if (choice === 'system') {
      // No stored preference means "follow the OS" — the boot script in the
      // root layout reads it back exactly this way.
      localStorage.removeItem(THEME_KEY)
      document.documentElement.dataset.theme = window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
    } else {
      localStorage.setItem(THEME_KEY, choice)
      document.documentElement.dataset.theme = choice
    }
  }

  const loadSources = useCallback(async () => {
    setSourceError('')
    try {
      const res = await api.get<{ sources: Source[] }>('/v1/discover/sources')
      setSources(res.sources ?? [])
    } catch (e) {
      setSourceError((e as Error).message)
      setSources([])
    }
  }, [])

  useEffect(() => {
    void loadSources()
  }, [loadSources])

  return (
    <Shell
      crumbs={
        <>
          <Link href="/app">Home</Link>
          <span className="sep">/</span>
          <span className="here">Settings</span>
        </>
      }
    >
      <div className="page page-narrow">
        <header className="page-head">
          <h1>Settings</h1>
          <p className="muted">Who you are here, how this looks, and what this engine can actually reach.</p>
        </header>

        <div className="stack" style={{ ['--gap' as string]: '28px' }}>
          {/* --- identity ---------------------------------------------------- */}
          <Section title="Identity">
            <div className="card card-pad col" style={{ gap: 16 }}>
              {loading && !user ? (
                <div className="row" style={{ gap: 14 }}>
                  <Skeleton h={44} w={44} />
                  <div className="col grow" style={{ gap: 7 }}>
                    <Skeleton h={14} w={160} />
                    <Skeleton h={12} w={100} />
                  </div>
                </div>
              ) : user ? (
                <>
                  <div className="row wrap" style={{ gap: 14 }}>
                    <Avatar name={user.name} color={user.accent} size="lg" />
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>{user.name}</div>
                      <div className="small faint mono">@{user.handle}</div>
                    </div>
                    <button
                      className="btn btn-secondary"
                      disabled={signingOut}
                      onClick={() => {
                        setSigningOut(true)
                        void signOut()
                      }}
                    >
                      {signingOut ? 'Signing out…' : 'Sign out'}
                    </button>
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                      gap: 14,
                    }}
                  >
                    <Field label="Handle">
                      <span className="mono small">@{user.handle}</span>
                    </Field>
                    <Field label="Display name">
                      <span className="small">{user.name}</span>
                    </Field>
                    <Field label="Email">
                      <span className="mono small">{user.email || '—'}</span>
                    </Field>
                    <Field label="Member id">
                      <span className="mono small">{user.id}</span>
                    </Field>
                  </div>

                  <p className="tiny faint" style={{ margin: 0 }}>
                    Your account is backed by an HttpOnly session; the browser cannot read it. Every charge still
                    needs your own passkey on Prava’s page. Signing out ends this browser session while your record,
                    circles and receipts remain in the hosted engine database.
                  </p>
                </>
              ) : (
                <p className="small muted" style={{ margin: 0 }}>
                  You are signed out.
                </p>
              )}
            </div>
          </Section>

          {/* --- appearance -------------------------------------------------- */}
          <Section title="Appearance">
            <div className="card card-pad col" style={{ gap: 12 }}>
              <div className="row wrap" style={{ gap: 14 }}>
                <div
                  className="row"
                  role="group"
                  aria-label="Theme"
                  style={{
                    gap: 4,
                    padding: 4,
                    background: 'var(--surface-2)',
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--r)',
                    width: 'fit-content',
                  }}
                >
                  {THEMES.map((t) => {
                    const on = theme === t.id
                    return (
                      <button
                        key={t.id}
                        className="btn"
                        aria-pressed={on}
                        onClick={() => applyTheme(t.id)}
                        style={
                          on
                            ? {
                                background: 'var(--surface)',
                                border: '1px solid var(--line)',
                                boxShadow: 'var(--shadow-1)',
                                color: 'var(--ink)',
                              }
                            : { color: 'var(--ink-2)' }
                        }
                      >
                        <span aria-hidden>{t.glyph}</span> {t.label}
                      </button>
                    )
                  })}
                </div>
              </div>
              <p className="tiny faint" style={{ margin: 0 }}>
                Stored on this device only, at <code className="mono">localStorage["sutra-theme"]</code>, and applied
                as <code className="mono">data-theme</code> before first paint — so a dark reload never flashes paper.
                System follows your OS and stores nothing.
              </p>
            </div>
          </Section>

          {/* --- notifications ---------------------------------------------- */}
          <Section title="Notifications" hint="when someone accepts, declines, or a group commits">
            <div className="card card-pad col" style={{ gap: 14 }}>
              {(() => {
                const support = pushSupported()
                if (!support.supported) {
                  return (
                    <p className="small muted" style={{ margin: 0 }}>
                      {support.reason}
                    </p>
                  )
                }
                return (
                  <>
                    <p className="small muted" style={{ margin: 0 }}>
                      Optional. Browser push for when you are not looking at the tab. Protocol events
                      only reach a device that has turned this on — there is no separate in-app inbox
                      bell yet.
                    </p>
                    <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
                      <button
                        className="btn btn-primary"
                        disabled={!user || pushBusy}
                        onClick={() => {
                          setPushBusy(true)
                          setPushNote('')
                          void (async () => {
                            try {
                              if (pushOn) {
                                const res = await disablePush()
                                if (res.ok) {
                                  setPushOn(false)
                                  setPushNote('Notifications turned off for this browser.')
                                } else {
                                  setPushNote(res.reason ?? 'Could not turn notifications off.')
                                }
                              } else {
                                const res = await enablePush()
                                if (res.ok) {
                                  setPushOn(true)
                                  setPushNote('Notifications are on for this browser.')
                                } else {
                                  setPushNote(res.reason ?? 'Could not turn notifications on.')
                                }
                              }
                            } finally {
                              setPushBusy(false)
                            }
                          })()
                        }}
                      >
                        {pushBusy ? 'Working…' : pushOn ? 'Turn off notifications' : 'Turn on notifications'}
                      </button>
                      <span className="tiny faint">{pushOn ? 'On in this browser' : 'Off'}</span>
                    </div>
                    {pushNote && <p className="tiny muted" style={{ margin: 0 }}>{pushNote}</p>}
                  </>
                )
              })()}
            </div>
          </Section>

          <Section title="Browser extension" hint="same people and circles, on any product page">
            <div className="card card-pad col" style={{ gap: 14 }}>
              <p className="small muted" style={{ margin: 0 }}>
                Connect the extension to this account with a revocable device token. It can read your friends and
                circles and create groups for you; it never receives the engine master key or payment credentials.
              </p>
              {extensionToken ? (
                <>
                  <Field label="One-time token">
                    <code className="mono small" style={{ overflowWrap: 'anywhere' }}>{extensionToken}</code>
                  </Field>
                  <div className="row wrap" style={{ gap: 8 }}>
                    <button className="btn btn-primary" onClick={() => {
                      void navigator.clipboard.writeText(extensionToken)
                      setExtensionStatus('Copied. Paste it into the sutra extension.')
                    }}>Copy token</button>
                    <button className="btn btn-secondary" onClick={() => setExtensionToken('')}>Hide</button>
                  </div>
                </>
              ) : (
                <div className="row wrap" style={{ gap: 8 }}>
                  <button className="btn btn-primary" disabled={!user} onClick={async () => {
                    setExtensionStatus('')
                    try {
                      const result = await api.post<{ token: string }>('/v1/me/extension-token')
                      setExtensionToken(result.token)
                    } catch (error) { setExtensionStatus((error as Error).message) }
                  }}>Create extension token</button>
                  <button className="btn btn-secondary" disabled={!user} onClick={async () => {
                    const result = await api.post<{ revoked: number }>('/v1/me/extension-token/revoke')
                    setExtensionToken('')
                    setExtensionStatus(`Disconnected ${result.revoked} extension session${result.revoked === 1 ? '' : 's'}.`)
                  }}>Disconnect extensions</button>
                </div>
              )}
              {extensionStatus && <p className="tiny muted" style={{ margin: 0 }}>{extensionStatus}</p>}
              <p className="tiny faint" style={{ margin: 0 }}>
                Tokens expire after 90 days and are stored as a one-way hash in the database. Payment approval still
                happens per person on the payment rail.
              </p>
            </div>
          </Section>

          {/* --- engine ------------------------------------------------------ */}
          <Section
            title="Engine"
            hint="what discovery can reach right now"
            action={
              <button className="btn btn-ghost small" onClick={() => void loadSources()}>
                Re-check
              </button>
            }
          >
            <div className="card">
              {sourceError && (
                <div style={{ padding: 14 }}>
                  <ErrorNote>
                    We couldn’t ask the engine which sources are up — {sourceError}.{' '}
                    <button
                      className="btn btn-ghost tiny"
                      style={{ padding: '0 4px', textDecoration: 'underline' }}
                      onClick={() => void loadSources()}
                    >
                      Try again
                    </button>
                  </ErrorNote>
                </div>
              )}

              {sources === null &&
                [0, 1, 2].map((i) => (
                  <div className="list-row" key={i}>
                    <Skeleton h={8} w={8} />
                    <div className="grow col" style={{ gap: 6 }}>
                      <Skeleton h={13} w={150} />
                      <Skeleton h={11} w={90} />
                    </div>
                    <Skeleton h={16} w={44} />
                  </div>
                ))}

              {sources?.map((s) => (
                <div className="list-row wrap" key={s.kind}>
                  <span className={s.available ? 'dot dot-ok' : 'dot'} aria-hidden />
                  <div className="grow" style={{ minWidth: 160 }}>
                    <div className="row" style={{ gap: 8 }}>
                      <span style={{ fontWeight: 550 }}>{s.label}</span>
                      <span className="tiny faint mono">{s.kind}</span>
                    </div>
                    {!s.available && (
                      <p className="small muted" style={{ margin: '2px 0 0' }}>
                        {s.reason ?? 'The engine did not say why. Treat it as unavailable.'}
                      </p>
                    )}
                  </div>
                  <Badge tone={s.available ? 'ok' : 'plain'}>{s.available ? 'live' : 'dark'}</Badge>
                </div>
              ))}

              {sources !== null && sources.length === 0 && !sourceError && (
                <p className="small muted" style={{ padding: 16, margin: 0 }}>
                  This engine has no discovery sources configured. You can still paste a product link — resolving a URL
                  does not need a source.
                </p>
              )}
            </div>
            <p className="tiny faint" style={{ marginTop: 8 }}>
              A dark source is not hidden here. Search results only ever come from the sources marked live, so you
              always know what you were shown and what you weren’t.
            </p>
          </Section>

          {/* --- money ------------------------------------------------------- */}
          <Section title="How your money moves">
            <div className="card card-pad">
              <MoneyFlow />
            </div>
          </Section>
        </div>
      </div>
    </Shell>
  )
}
