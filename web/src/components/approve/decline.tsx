'use client'

import type { Policy } from '@/lib/api'
import { Modal, PolicyChip } from '@/components/ui'
import { declineCopy } from './model'

/**
 * The one destructive action on the page, and its consequence is not the same
 * for everybody: under all_of a decline cancels the purchase for the whole
 * group, under quorum it only removes you. The dialog says which.
 */
export function DeclineDialog({
  policy,
  you,
  busy,
  onClose,
  onConfirm,
}: {
  policy: Policy | null
  you: string
  busy: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  const copy = declineCopy(policy, you)

  return (
    <Modal
      title={copy.title}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Keep my share
          </button>
          <button className="btn btn-danger" onClick={onConfirm} disabled={busy}>
            {busy ? 'Declining…' : copy.confirm}
          </button>
        </>
      }
    >
      <p className="small muted" style={{ marginBottom: 14 }}>
        {copy.body}
      </p>
      {policy && <PolicyChip policy={policy} />}
      <p className="tiny faint" style={{ marginTop: 14 }}>
        Declining is instant and cannot be undone from this page. If you change your mind, whoever started the
        group has to invite you again.
      </p>
    </Modal>
  )
}
