'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'

const STEPS = [
  { mode: 'intent', eyebrow: '01 · intent', line: '“Goa next month?”', detail: 'A sentence becomes a structured plan: dates, budget, location and who needs to answer.' },
  { mode: 'people', eyebrow: '02 · group', line: 'Your people, already here.', detail: 'Choose friends or a circle. Each person keeps their own identity, constraints and approval.' },
  { mode: 'decision', eyebrow: '03 · decision', line: 'The option that actually fits.', detail: 'Named sources provide facts. Availability, budget and preference signals rank the real options.' },
  { mode: 'money', eyebrow: '04 · consent', line: 'Four approvals. One commit.', detail: 'Every share is explicit. Supported payment rails commit together; unsupported merchants hand back honestly.' },
] as const

export function ScrollStory() {
  const root = useRef<HTMLElement>(null)
  const [active, setActive] = useState(0)
  const [progress, setProgress] = useState(0)
  useEffect(() => {
    let frame = 0
    const update = () => {
      frame = 0
      const node = root.current
      if (!node) return
      const rect = node.getBoundingClientRect()
      const distance = Math.max(1, node.offsetHeight - window.innerHeight)
      const next = Math.max(0, Math.min(1, -rect.top / distance))
      setProgress(next)
      setActive(next < .14 ? 0 : next < .39 ? 1 : next < .66 ? 2 : 3)
    }
    const onScroll = () => { if (!frame) frame = window.requestAnimationFrame(update) }
    update()
    addEventListener('scroll', onScroll, { passive: true })
    addEventListener('resize', onScroll)
    return () => { removeEventListener('scroll', onScroll); removeEventListener('resize', onScroll); if (frame) cancelAnimationFrame(frame) }
  }, [])
  return (
    <section id="story" className="l-scroll-story" ref={root} aria-label="From idea to coordinated purchase">
      <div className="l-story-stage">
        <div className="l-story-copy" key={active}>
          <span>{STEPS[active].eyebrow}</span><h2>{STEPS[active].line}</h2><p>{STEPS[active].detail}</p>
        </div>
        <div className="l-story-device" data-mode={STEPS[active].mode} style={{ '--story-progress': progress } as CSSProperties}>
          <div className="l-story-glow" />
          <div className="l-story-phone">
            <i className="l-phone-button l-phone-action" /><i className="l-phone-button l-phone-volume-a" /><i className="l-phone-button l-phone-volume-b" /><i className="l-phone-button l-phone-power" />
            <div className="l-phone-island"><i /></div>
            <header><i /><b>sutra</b><em>{active + 1}/4</em></header>
            <div className="l-story-screen">
              <div className="story-intent">Goa next month? <span>Build the plan →</span></div>
              <div className="story-people"><i>A</i><i>B</i><i>C</i><i>D</i><b>Weekend escape</b><span>4 people · everyone answers</span></div>
              <div className="story-decision"><small>BEST FIT · 92</small><b>Vagator · 3 nights</b><span>₹8.4k each · all four available</span><em>2 alternatives</em></div>
              <div className="story-money"><b>Ready together</b><span>₹8,420</span><div><i /><i /><i /><i /></div><small>4 capped approvals · merchant supported</small></div>
            </div>
          </div>
          <div className="l-story-orbit"><i /><i /><i /></div>
        </div>
      </div>
      <div className="l-story-triggers" aria-hidden>{STEPS.map((_, index) => <div data-story-step={index} key={index} />)}</div>
    </section>
  )
}
