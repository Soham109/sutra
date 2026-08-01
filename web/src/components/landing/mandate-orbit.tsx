'use client'

import { useRef } from 'react'

const PEOPLE = [
  { name: 'Soham', amount: '₹780', x: '10%', y: '24%', color: '#ff7352' },
  { name: 'Maya', amount: '₹780', x: '77%', y: '12%', color: '#247d9b' },
  { name: 'Arsh', amount: '₹780', x: '82%', y: '70%', color: '#6a56d6' },
  { name: 'Dev', amount: '₹780', x: '7%', y: '73%', color: '#32775b' },
]

export function MandateOrbit() {
  const scene = useRef<HTMLDivElement>(null)

  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    const node = scene.current
    if (!node || event.pointerType === 'touch') return
    const box = node.getBoundingClientRect()
    const x = (event.clientX - box.left) / box.width - 0.5
    const y = (event.clientY - box.top) / box.height - 0.5
    node.style.setProperty('--orbit-rx', `${(-y * 8).toFixed(2)}deg`)
    node.style.setProperty('--orbit-ry', `${(x * 10).toFixed(2)}deg`)
  }

  const reset = () => {
    scene.current?.style.setProperty('--orbit-rx', '0deg')
    scene.current?.style.setProperty('--orbit-ry', '0deg')
  }

  return (
    <div className="orbit-shell" ref={scene} onPointerMove={move} onPointerLeave={reset}>
      <div className="orbit-atmosphere" />
      <div className="orbit-stage">
        <div className="orbit-ring orbit-ring-a" />
        <div className="orbit-ring orbit-ring-b" />
        <div className="orbit-ring orbit-ring-c" />

        <article className="orbit-core">
          <div className="orbit-command">
            <span>Plan</span>
            <p>“Dinner Saturday near Indiranagar, under ₹900 each.”</p>
          </div>
          <div className="orbit-pick">
            <div>
              <small>Best fit</small>
              <strong>Burma Burma · 8:00 PM</strong>
            </div>
            <span>4.7 km</span>
          </div>
          <div className="orbit-rule"><i /><span>Everyone approves their own ₹780</span></div>
          <div className="orbit-meter"><span /></div>
          <footer><span>3 ready</span><b>1 deciding</b></footer>
        </article>

        {PEOPLE.map((person, index) => (
          <div
            className={`orbit-person orbit-person-${index + 1}`}
            key={person.name}
            style={{ '--px': person.x, '--py': person.y, '--pc': person.color } as React.CSSProperties}
          >
            <i>{person.name[0]}</i>
            <span><b>{person.name}</b><small>{person.amount}</small></span>
          </div>
        ))}

        <div className="orbit-receipt"><span>✓</span><div><b>Signed receipt</b><small>4 consent records</small></div></div>
        <div className="orbit-merchant"><span>Merchant</span><b>₹3,120</b></div>
      </div>
    </div>
  )
}
