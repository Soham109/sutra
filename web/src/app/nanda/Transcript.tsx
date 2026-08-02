// Renders a verbatim captured stdout block. The only thing this component is
// allowed to do to the text is color individual lines by a pattern already
// present in that exact line — it never adds, removes, or reorders a
// character. `=== ACT` headers get the brand colour, `[PASS]` lines get the
// ok colour; everything else renders exactly as printed, in the well the
// rest of this design system already uses for "verifiable facts, not prose".

function lineClass(line: string): string | undefined {
  if (line.startsWith('===')) return 'tty-act'
  if (line.includes('[PASS]')) return 'tty-pass'
  if (line.includes('AttributeError') || line.includes('DECLINES')) return 'tty-flag'
  return undefined
}

export function Transcript({ text }: { text: string }) {
  const lines = text.split('\n')
  return (
    <pre className="well tty mono">
      {lines.map((line, i) => {
        const cls = lineClass(line)
        return (
          <span className={cls ? `tty-line ${cls}` : 'tty-line'} key={i}>
            {line}
            {'\n'}
          </span>
        )
      })}
    </pre>
  )
}
