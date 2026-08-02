'use client'

import { useEffect, useState } from 'react'

type Scenario = 'cover' | 'cancel'
const PEOPLE = ['Ada', 'Ben', 'Cleo', 'Dev']

export function ConsentThreadDemo() {
  const [scenario, setScenario] = useState<Scenario>('cover')
  const [step, setStep] = useState(0)
  const [playing, setPlaying] = useState(true)
  useEffect(() => {
    if (!playing || step >= 3) return
    const timer = window.setTimeout(() => setStep((value) => value + 1), 850)
    return () => window.clearTimeout(timer)
  }, [step, playing, scenario])
  const choose = (next: Scenario) => { setScenario(next); setStep(0); setPlaying(true) }
  const state = (index: number) => {
    if (step === 0) return index === 0 ? 'ready' : 'waiting'
    if (step === 1) return index < 2 ? 'ready' : index === 2 ? 'out' : 'waiting'
    if (step === 2) return index === 2 ? 'out' : 'ready'
    return scenario === 'cover' ? (index === 2 ? 'released' : 'paid') : 'released'
  }
  const copy = [
    'Ada approves — capped at her own ₹780.',
    'Ben approves. Cleo says no — ₹0 charged so far.',
    scenario === 'cover' ? 'Ada already agreed to cover Cleo’s share.' : 'The rule needed all four people.',
    scenario === 'cover' ? 'Three cards go through. The cinema gets ₹3,120.' : 'Every pending charge is released. Nobody is charged.',
  ][step]
  return (
    <div className="consent-live">
      <div className="consent-controls">
        <div><span>LIVE RULE REPLAY</span><h3>Friday · 8:40 PM</h3><p>4 people · ₹3,120 total</p></div>
        <div role="group" aria-label="Choose group rule">
          <button aria-pressed={scenario === 'cover'} onClick={() => choose('cover')}>Ada covers Cleo</button>
          <button aria-pressed={scenario === 'cancel'} onClick={() => choose('cancel')}>Needs all four</button>
        </div>
      </div>
      <div className="consent-stage">
        <div className="consent-people">
          {PEOPLE.map((person, index) => <div className="consent-person" data-state={state(index)} key={person}>
            <i>{person[0]}</i><b>{person}</b><span>{state(index) === 'paid' ? (index === 0 ? '₹1,560 paid' : '₹780 paid') : state(index) === 'ready' ? '₹780 ready' : state(index) === 'out' ? 'said no' : state(index) === 'released' ? 'released' : 'waiting'}</span>
          </div>)}
        </div>
        <div className="consent-core" data-result={step === 3 ? scenario : 'live'}>
          <div className="consent-ring"><i /><i /><i /></div>
          <span>{step + 1}/4</span><strong>{step === 3 ? scenario === 'cover' ? 'COMMITTED' : 'CANCELLED' : 'COLLECTING'}</strong>
          <small>{step === 3 ? scenario === 'cover' ? '₹3,120 · 3 people charged, each their own amount' : '₹0 moved · all 4 permissions released' : 'Nothing can move yet'}</small>
        </div>
      </div>
      <div className="consent-caption"><p key={`${scenario}-${step}`}>{copy}</p><div>{[0,1,2,3].map((index) => <button key={index} aria-label={`Step ${index + 1}`} data-on={index <= step} onClick={() => { setStep(index); setPlaying(false) }} />)}</div><button className="consent-replay" onClick={() => { setStep(0); setPlaying(true) }}>{playing && step < 3 ? 'Playing' : 'Replay'} ↻</button></div>
    </div>
  )
}
