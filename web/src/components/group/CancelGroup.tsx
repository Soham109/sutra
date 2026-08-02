'use client'

import { useState } from 'react'
import { ApiError, api, type Group } from '@/lib/api'
import { ErrorNote, Modal, Spinner } from '@/components/ui'

// Cancelling is refused once the charges are in flight. The engine is right to
// refuse — so the UI explains the refusal instead of showing a failed request.

export function CancelGroup({ group, onGroup }: { group: Group; onGroup: (g: Group) => void }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)

  if (group.terminal) return null
  const charges = group.rail_capability?.charges ?? group.rail === 'prava_mandates'

  const run = async () => {
    setBusy(true)
    setRefusal(null)
    try {
      const next = await api.post<Group>(`/v1/groups/${encodeURIComponent(group.group_id)}/cancel`)
      onGroup(next)
      if (next.status === 'aborted') {
        setOpen(false)
      } else if (next.terminal) {
        // The engine no-ops on an already-finished group and hands back the view.
        setRefusal('This group had already finished before the cancel landed, so there was nothing left to stop.')
      } else {
        setRefusal('The engine kept the group open. Nothing was cancelled — check the log for what changed.')
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setRefusal(
          charges
            ? 'Too late to cancel — the charge sequence has started. Watch the log: every provider result is reconciled and the receipt records any partial outcome.'
            : 'Too late to cancel — the group is sealing the agreement. Watch the log for the final signed outcome.',
        )
      } else if (err instanceof ApiError && err.status === 404) {
        setRefusal('That group is no longer on the engine.')
      } else {
        setRefusal(err instanceof Error ? err.message : 'The engine could not be reached.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button className="btn btn-danger" onClick={() => setOpen(true)}>
        Cancel group
      </button>

      {open && (
        <Modal
          title="Cancel this group?"
          onClose={() => !busy && setOpen(false)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setOpen(false)} disabled={busy}>
                Keep it open
              </button>
              <button className="btn btn-danger" onClick={() => void run()} disabled={busy}>
                {busy ? 'Cancelling…' : 'Cancel the group'}
              </button>
            </>
          }
        >
          <p className="small">
            {charges ? (
              <>Every unused test mandate lapses and <b>no charge sequence begins</b>. This cannot be undone; you would have to start a new group.</>
            ) : (
              <>Every invitation closes and <b>no agreement is sealed as complete</b>. This cannot be undone; you would have to start a new group.</>
            )}
          </p>
          <p className="small muted" style={{ marginTop: 10 }}>
            Once the group reaches its point of no return, the engine refuses to cancel so the final record cannot contradict work already in flight.
          </p>
          {busy && (
            <div style={{ marginTop: 12 }}>
              <Spinner label="Asking the engine to stand down…" />
            </div>
          )}
          {refusal && (
            <div style={{ marginTop: 12 }}>
              <ErrorNote>
                {refusal}{' '}
                <button
                  className="btn btn-ghost tiny"
                  onClick={() => {
                    setRefusal(null)
                    setOpen(false)
                  }}
                >
                  Back to the war room
                </button>
              </ErrorNote>
            </div>
          )}
        </Modal>
      )}
    </>
  )
}
