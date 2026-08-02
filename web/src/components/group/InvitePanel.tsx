'use client'

import { useEffect, useState } from 'react'
import type { GroupMember } from '@/lib/api'
import { PassThePhone, buildInviteText } from './PassThePhone'

interface NdefWriter {
  write: (message: { records: { recordType: 'url'; data: string }[] }) => Promise<void>
}

type NdefConstructor = new () => NdefWriter

export function InvitePanel({ groupId, title, members = [], currency = 'USD' }: { groupId: string; title: string; members?: GroupMember[]; currency?: string }) {
  const [url, setUrl] = useState('')
  const [status, setStatus] = useState('')
  const [qrOpen, setQrOpen] = useState(false)
  const [canShare, setCanShare] = useState(false)
  const [canWriteNfc, setCanWriteNfc] = useState(false)
  const [passOpen, setPassOpen] = useState(false)

  useEffect(() => {
    setUrl(`${window.location.origin}/j/${groupId}`)
    setCanShare(typeof window.navigator.share === 'function')
    setCanWriteNfc('NDEFReader' in window)
  }, [groupId])

  const copy = async () => {
    if (!url) return
    try {
      await window.navigator.clipboard.writeText(url)
      setStatus('Join link copied')
    } catch {
      setStatus('Could not copy — select the link below')
    }
  }

  const share = async () => {
    if (!url || !window.navigator.share) return
    try {
      await window.navigator.share({ title, text: `Choose your share for ${title}`, url })
      setStatus('Share sheet opened')
    } catch (cause) {
      if ((cause as Error).name !== 'AbortError') setStatus('Could not open the share sheet')
    }
  }

  const payers = members.filter((m) => m.role !== 'observer')

  /** One pre-written message carrying every person's own link. */
  const shareEveryone = async () => {
    const text = buildInviteText(members, currency, title, window.location.origin)
    try {
      if (window.navigator.share) {
        await window.navigator.share({ title, text })
        setStatus('Share sheet opened')
        return
      }
      await window.navigator.clipboard.writeText(text)
      setStatus(`Copied ${payers.length} personal links — paste them into the group chat`)
    } catch (cause) {
      if ((cause as Error).name !== 'AbortError') setStatus('Could not share — copy the link below instead')
    }
  }

  const writeNfc = async () => {
    if (!url) return
    const Reader = (window as unknown as { NDEFReader?: NdefConstructor }).NDEFReader
    if (!Reader) return
    try {
      setStatus('Hold the NFC tag near this phone…')
      await new Reader().write({ records: [{ recordType: 'url', data: url }] })
      setStatus('NFC tag programmed')
    } catch (cause) {
      setStatus((cause as Error).name === 'NotAllowedError' ? 'NFC permission was not granted' : 'Could not program this tag')
    }
  }

  return (
    <section className="invite-panel">
      <div className="invite-head">
        <div><span className="eyebrow">Bring everyone in</span><h3>One link for the whole group</h3></div>
        <span className="invite-signal"><i /> Ready</span>
      </div>
      <p>Send personal links to the group chat, or use the shared link when everyone is together.</p>
      <div className="invite-url"><span>{url || 'Preparing join link…'}</span><button type="button" onClick={() => void copy()}>Copy</button></div>
      <div className="invite-actions">
        {payers.length > 0 ? <button type="button" className="btn btn-primary" onClick={() => void shareEveryone()}>{canShare ? 'Send everyone their link' : 'Copy all links'}</button> : null}
        {payers.length > 0 ? <button type="button" className="btn btn-secondary" onClick={() => setPassOpen(true)}>Pass the phone round</button> : null}
        <button type="button" className="btn btn-secondary" onClick={() => setQrOpen((open) => !open)} aria-expanded={qrOpen}>{qrOpen ? 'Hide shared QR' : 'Show shared QR'}</button>
        {canWriteNfc ? <button type="button" className="btn btn-secondary" onClick={() => void writeNfc()}>Write NFC tag</button> : null}
      </div>
      {qrOpen ? <div className="invite-qr"><img src={`/api/v1/groups/${groupId}/join-qr.png`} alt={`QR code to join ${title}`} /><span>Scan once, then choose your name.</span></div> : null}
      {status ? <div className="invite-status" role="status">{status}</div> : null}
      {passOpen ? <PassThePhone members={members} currency={currency} title={title} onClose={() => setPassOpen(false)} /> : null}
    </section>
  )
}
