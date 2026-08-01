const LAYERS = [
  { name: 'A sentence, link, photo or agent', meta: 'INTENT', tone: 'signal' },
  { name: 'People · time · place · budget', meta: 'COORDINATION', tone: 'violet' },
  { name: 'Items · shares · policy · deadline', meta: 'ALLOCATION', tone: 'paper' },
  { name: 'One capped consent per person', meta: 'GMP/1', tone: 'ink' },
  { name: 'Merchant paid · signed receipt', meta: 'COMMIT', tone: 'green' },
]

export function ProtocolStack() {
  return (
    <div className="protocol-stack" aria-label="Sutra's product layers">
      <div className="stack-axis"><span>Human mess</span><i /><span>Verifiable outcome</span></div>
      <div className="stack-scene">
        {LAYERS.map((layer, index) => (
          <article className="stack-layer" data-tone={layer.tone} style={{ '--layer': index } as React.CSSProperties} key={layer.meta}>
            <span>{layer.meta}</span><strong>{layer.name}</strong><i>{String(index + 1).padStart(2, '0')}</i>
          </article>
        ))}
      </div>
    </div>
  )
}
