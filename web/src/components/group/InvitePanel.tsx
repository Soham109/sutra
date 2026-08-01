'use client'

import { useEffect, useState } from 'react'

interface NdefWriter {
  write: (message: { records: { recordType: 'url'; data: string }[] }) => Promise<void>
}

type NdefConstructor = new () => NdefWriter

export function InvitePanel({ groupId, title }: { groupId: string; title: string }) {
  const [url, setUrl] = useState('')
  const [status, setStatus] = useState('')
  const [qrOpen, setQrOpen] = useState(false)
  const [canShare, setCanShare] = useState(false)
  const [canWriteNfc, setCanWriteNfc] = useState(false)

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
        <span className="invite-signal"><i /> Live</span>
      </div>
      <p>Friends choose their name, inspect their exact share, then approve with their own passkey.</p>
      <div className="invite-url"><span>{url || 'Preparing join link…'}</span><button type="button" onClick={() => void copy()}>Copy</button></div>
      <div className="invite-actions">
        {canShare ? <button type="button" className="btn btn-primary" onClick={() => void share()}>Share invite</button> : null}
        <button type="button" className="btn btn-secondary" onClick={() => setQrOpen((open) => !open)}>{qrOpen ? 'Hide QR' : 'Show QR'}</button>
        {canWriteNfc ? <button type="button" className="btn btn-secondary" onClick={() => void writeNfc()}>Write NFC tag</button> : null}
      </div>
      {qrOpen ? <div className="invite-qr"><img src={`/api/v1/groups/${groupId}/join-qr.png`} alt={`QR code to join ${title}`} /><span>Scan once, then choose your name.</span></div> : null}
      {status ? <div className="invite-status" role="status">{status}</div> : null}
    </section>
  )
}
