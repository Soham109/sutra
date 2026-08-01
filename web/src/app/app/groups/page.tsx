'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { Shell } from '@/components/shell'
import { Empty, ErrorNote, Skeleton } from '@/components/ui'
import { GroupStyles } from '@/components/group/styles'
import { GroupRow } from '@/components/group/GroupRow'
import { api, type Group } from '@/lib/api'

// Rows, not cards. A group is a line in a ledger — and the ledger is the point.

export default function GroupsPage() {
  const [groups, setGroups] = useState<Group[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await api.get<{ groups: Group[] }>('/v1/my/groups')
      setGroups(res.groups ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach the engine.')
      setGroups([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const live = (groups ?? []).filter((g) => !g.terminal)
  const done = (groups ?? []).filter((g) => g.terminal)

  return (
    <Shell crumbs={<span className="here">Groups</span>}>
      <GroupStyles />
      <div className="page">
        <div className="page-head row-between wrap">
          <div>
            <h1>Groups</h1>
            <p className="small muted">
              Every group you started or were invited to. Nothing here can charge you — your own approval always
              happens on your own device.
            </p>
          </div>
          <Link href="/app/discover" className="btn btn-primary">
            Start a group buy
          </Link>
        </div>

        {error && (
          <div style={{ marginBottom: 16 }}>
            <ErrorNote>
              {error}{' '}
              <button className="btn btn-ghost tiny" onClick={() => void load()}>
                Try again
              </button>
            </ErrorNote>
          </div>
        )}

        {groups === null && (
          <div className="card">
            {[0, 1, 2, 3].map((i) => (
              <div className="list-row" key={i}>
                <Skeleton h={24} w={104} />
                <div className="grow col" style={{ gap: 6 }}>
                  <Skeleton h={13} w="42%" />
                  <Skeleton h={11} w="24%" />
                </div>
                <Skeleton h={20} w={92} />
              </div>
            ))}
          </div>
        )}

        {groups !== null && groups.length === 0 && !error && (
          <div className="card">
            <Empty
              title="No groups yet"
              action={
                <Link href="/app/discover" className="btn btn-primary">
                  Find something to buy
                </Link>
              }
            >
              A group buy is one cart, one rule, and one card per person. Everyone approves their own share on their
              own device — then the whole group commits at once, or nobody is charged at all. Start by finding
              something, or paste any product link.
            </Empty>
          </div>
        )}

        {live.length > 0 && (
          <section style={{ marginBottom: 26 }}>
            <div className="row-between" style={{ marginBottom: 8 }}>
              <span className="eyebrow">Live</span>
              <span className="tiny faint mono">{live.length}</span>
            </div>
            <div className="card">
              {live.map((g) => (
                <GroupRow key={g.group_id} group={g} />
              ))}
            </div>
          </section>
        )}

        {done.length > 0 && (
          <section>
            <div className="row-between" style={{ marginBottom: 8 }}>
              <span className="eyebrow">Finished</span>
              <span className="tiny faint mono">{done.length}</span>
            </div>
            <div className="card">
              {done.map((g) => (
                <GroupRow key={g.group_id} group={g} />
              ))}
            </div>
          </section>
        )}
      </div>
    </Shell>
  )
}
