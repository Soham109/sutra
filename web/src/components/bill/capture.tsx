'use client'

import { useCallback, useRef, useState } from 'react'

// Photograph the bill.
//
// The reading happens in the browser. That is a deliberate choice, not a
// fallback: a receipt is a photograph of what a group of named people ate, on a
// specific night, at a specific address, and it does not need to leave the
// phone to become a list of numbers. It also means this works with no API key
// and no network round trip.
//
// OCR is never trusted. It produces a DRAFT that the human sees and can correct
// before anything is parsed, and the parser then reconciles the lines against
// the printed total anyway. Two independent checks on a machine reading of a
// crumpled receipt is the minimum before you ask people to agree to a number.

type Stage = 'idle' | 'preparing' | 'reading' | 'done' | 'failed'

/** Below this, the local read is not worth trusting on its own. */
const LOW_CONFIDENCE = 70

/**
 * Ask the engine to transcribe the photo instead. Returns null whenever that
 * is not available — no vision key configured is the normal case, not an error.
 */
async function secondOpinion(file: File): Promise<string | null> {
  const dataUrl: string = await new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('could not read the file'))
    r.readAsDataURL(file)
  })

  // Reuse the engine's real bill endpoint. It performs the vision hop and
  // immediately runs the transcript through the deterministic parser, so the
  // browser never depends on a second, undocumented transcription contract.
  const res = await fetch('/api/v1/bill/parse', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ image_base64: dataUrl }),
  })
  if (!res.ok) return null
  const body = (await res.json()) as { transcript?: string }
  return body.transcript?.trim() || null
}

export function BillCapture({
  onText,
  busy,
}: {
  /** Called with the draft. The caller shows it for correction. */
  onText: (text: string, meta: { confidence: number; source: 'ocr' | 'vision' }) => void
  busy?: boolean
}) {
  const [stage, setStage] = useState<Stage>('idle')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<string | null>(null)
  const [visionCandidate, setVisionCandidate] = useState<{ file: File; confidence: number } | null>(null)
  const [visionBusy, setVisionBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)

  const read = useCallback(async (file: File) => {
    setError('')
    setStage('preparing')
    setProgress(0)
    setVisionCandidate(null)

    const url = URL.createObjectURL(file)
    setPreview(url)

    try {
      // Loaded on demand: the OCR engine is a couple of megabytes of wasm and
      // language data, and most people never open this screen.
      const { createWorker } = await import('tesseract.js')

      setStage('reading')
      const worker = await createWorker('eng', 1, {
        logger: (m: { status: string; progress: number }) => {
          if (m.status === 'recognizing text') setProgress(Math.round(m.progress * 100))
        },
      })

      try {
        // Page-segmentation mode 6 — "a single uniform block of text".
        //
        // This is measured, not guessed. Modes 3, 4, 11 and 12 all treat the
        // item names and the amounts as separate COLUMNS and emit them as
        // separate blocks, which fractures "2587.50" into "2587." on one line
        // and "50" on another. The parser then reconciles 2587.00 against a
        // printed 2587.00 and reports, perfectly truthfully, that the maths
        // checks out — on numbers that are wrong. Mode 6 keeps each line whole:
        // 8/8 exact amounts and zero orphans against the same test receipt.
        await worker.setParameters({ tessedit_pageseg_mode: '6' as never })
        const { data } = await worker.recognize(file)
        const text = (data.text ?? '').trim()

        if (!text) {
          setStage('failed')
          setError(
            'Nothing readable came out of that photo. Try again with the receipt flat, filling the frame, in good light — or type the lines in below.',
          )
          return
        }

        const confidence = Math.round(data.confidence ?? 0)

        // A low-confidence photo can benefit from a configured vision service,
        // but that would upload a receipt. Never do that as a silent fallback:
        // keep the on-device draft, then offer one explicit, disclosed button.
        if (confidence < LOW_CONFIDENCE) {
          setVisionCandidate({ file, confidence })
        }

        setStage('done')
        onText(text, { confidence, source: 'ocr' })
      } finally {
        await worker.terminate()
      }
    } catch (e) {
      setStage('failed')
      setError(
        `The reader could not start — ${(e as Error).message}. Type the lines in below instead; the text path needs nothing but your keyboard.`,
      )
    }
  }, [onText])

  const pick = (input: HTMLInputElement | null) => input?.click()

  const useVision = async () => {
    if (!visionCandidate || visionBusy) return
    setVisionBusy(true)
    setError('')
    try {
      const better = await secondOpinion(visionCandidate.file)
      if (!better) {
        setError('The configured vision service was unavailable. Keep correcting the on-device draft below.')
        return
      }
      onText(better, { confidence: visionCandidate.confidence, source: 'vision' })
      setVisionCandidate(null)
    } catch (caught) {
      setError(`The vision service could not read that photo — ${(caught as Error).message}.`)
    } finally {
      setVisionBusy(false)
    }
  }

  return (
    <div className="capture">
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void read(f)
          e.target.value = ''
        }}
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void read(f)
          e.target.value = ''
        }}
      />

      {preview && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="capture-preview" src={preview} alt="The bill you photographed" />
      )}

      {stage === 'idle' || stage === 'failed' ? (
        <div className="capture-actions">
          <button
            type="button"
            className="btn btn-primary btn-lg btn-block"
            disabled={busy}
            onClick={() => pick(cameraRef.current)}
          >
            Photograph the bill
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-block"
            disabled={busy}
            onClick={() => pick(fileRef.current)}
          >
            Choose an image
          </button>
        </div>
      ) : (
        <div className="capture-progress" role="status" aria-live="polite">
          <div className="capture-bar">
            <span style={{ width: `${stage === 'reading' ? progress : 4}%` }} />
          </div>
          <span className="tiny">
            {stage === 'preparing'
              ? 'Starting the reader…'
              : stage === 'reading'
                ? `Reading the receipt — ${progress}%`
                : 'Read.'}
          </span>
        </div>
      )}

      {error && <p className="capture-error">{error}</p>}

      {visionCandidate && (
        <div className="well" style={{ marginTop: 10 }}>
          <b>Local read confidence: {visionCandidate.confidence}%</b>
          <p className="small muted" style={{ margin: '5px 0 10px' }}>
            You can keep editing the on-device draft, or explicitly upload this receipt to the configured vision
            service for a second transcription. The service receives the full photo.
          </p>
          <button type="button" className="btn btn-secondary" disabled={visionBusy} onClick={() => void useVision()}>
            {visionBusy ? 'Uploading for a second read…' : 'Upload to vision service'}
          </button>
        </div>
      )}

      <p className="capture-note">
        The photo is read on this device by default. It leaves the device only if you explicitly choose the
        disclosed vision-service upload above. Every result is a draft—check it against the paper before anyone agrees.
      </p>
    </div>
  )
}
