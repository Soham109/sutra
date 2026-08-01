// A one-line footnote, not a second page. The form above already carries the
// primary action, and the "moments" row already carries the secondary one —
// this used to duplicate both with a second wall of text and a second grid
// of buttons. All it needs to do now is answer "why does this work" for
// anyone who actually wonders, without making everyone else read it first.

export function HowThisWorksNote() {
  return (
    <details className="discover-note">
      <summary>How does pasting a random link actually work?</summary>
      <p className="small muted" style={{ lineHeight: 1.65, marginTop: 8 }}>
        Most merchants publish structured product data on their own pages — the same feed they hand to Google
        Shopping so items show up there. Sutra reads that directly: title, price, currency, variants, stock. That is
        why a link from a store nobody here has ever integrated with usually just works, and why the price you see
        is the merchant’s own, not a scraped guess. Searching by name is narrower — it only reaches the handful of
        catalogues below that let themselves be searched.
      </p>
    </details>
  )
}
