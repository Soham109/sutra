'use client'

// The first thing anybody sees on this page. It has one job: explain why
// pasting a link from a store nobody integrated with actually works, and then
// give four things to press.

export function DiscoverIntro({
  onSearch,
  onSampleUrl,
  onFocusStore,
}: {
  onSearch: (q: string) => void
  onSampleUrl: () => void
  onFocusStore: () => void
}) {
  return (
    <div className="card card-pad col" style={{ gap: 18 }}>
      <div className="col" style={{ gap: 8, maxWidth: '64ch' }}>
        <span className="eyebrow">Start anywhere</span>
        <h2>Search a few catalogues, or paste a link from essentially any store.</h2>
        <p className="small muted" style={{ lineHeight: 1.65 }}>
          Most merchants already publish structured product data on their own pages — the same feed they hand to
          Google Shopping so their items show up there. Sutra reads that: title, price, currency, variants,
          availability, image. That is why a link from a store nobody here has ever integrated with usually just
          works, and why the price you see is the merchant’s own, not a scraped guess.
        </p>
        <p className="small muted" style={{ lineHeight: 1.65 }}>
          Searching is narrower on purpose. It only covers the catalogues that let themselves be searched, and the
          page tells you exactly which ones answered.
        </p>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
          gap: 10,
        }}
      >
        <Action
          label="Paste a product link"
          hint="Any item page, from any store"
          onClick={onSampleUrl}
        />
        <Action
          label="Search “espresso machine”"
          hint="Something a few people would split"
          onClick={() => onSearch('espresso machine')}
        />
        <Action
          label="Search “festival tickets”"
          hint="More people than units — a contested cart"
          onClick={() => onSearch('tickets')}
        />
        <Action
          label="Limit it to one store"
          hint="Type a domain like allbirds.com"
          onClick={onFocusStore}
        />
      </div>

      <p className="tiny faint" style={{ lineHeight: 1.6 }}>
        A link to a category, a search results page or a login-walled page will not resolve — those pages describe
        many products or none. Paste the page for the single item you want to buy.
      </p>
    </div>
  )
}

function Action({ label, hint, onClick }: { label: string; hint: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="well"
      style={{ textAlign: 'left', cursor: 'pointer', display: 'block' }}
    >
      <span className="row-between" style={{ gap: 8 }}>
        <span style={{ fontWeight: 550, fontSize: 14 }}>{label}</span>
        <span className="faint" aria-hidden>
          →
        </span>
      </span>
      <span className="tiny faint" style={{ display: 'block' }}>
        {hint}
      </span>
    </button>
  )
}
