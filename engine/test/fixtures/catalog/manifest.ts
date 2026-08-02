// The accuracy corpus. Every entry here was fetched from a real, live merchant
// page (see the HANDBOOK note at the bottom of catalog-accuracy.test.ts for
// exactly how) and the `expected` price was read BY HAND off the saved HTML —
// never derived from what the resolver itself returns. That is the whole
// point of a regression suite: it has to be able to catch the resolver being
// wrong, so it cannot be generated from the resolver being wrong.
//
// `platform` and `note` exist so a failing row in the printed table is
// legible without opening the fixture. `ownership` marks whether a fix for
// that row lives in parse.ts (mine) or resolver.ts/sources.ts (the other
// agent's, per the file split for this session).

export interface Fixture {
  id: string
  /** the exact URL a person would have pasted */
  url: string
  platform: string
  /** what a human reading the page would pay, in minor units, or null if the
   *  only honest answer is "refuse" (no single real price on the page) */
  expected: { amount_minor: number; currency: string } | null
  note: string
  /** which file tree owns fixing this row if it fails */
  ownership: 'parse.ts' | 'resolver.ts' | 'sources.ts'
}

export const FIXTURES: Fixture[] = [
  // ---- Shopify JSON path (India, per the brief's explicit ask) ----------
  {
    id: 'shopify-bombayshavingcompany-inr-discount',
    url: 'https://bombayshavingcompany.com/products/power-groomer-trimmer',
    platform: 'shopify (.js)',
    expected: { amount_minor: 94900, currency: 'INR' },
    note: 'Power Groomer 11-in-1, ₹949 vs struck-through ₹2000 (compare_at_price)',
    ownership: 'resolver.ts',
  },
  {
    id: 'shopify-bombayshavingcompany-json-fallback',
    url: 'https://bombayshavingcompany.com/products/power-groomer-trimmer',
    platform: 'shopify (.json fallback — decimal-string price)',
    expected: { amount_minor: 94900, currency: 'INR' },
    note: 'same product, forced through the <path>.json branch: price is the decimal string "949.00", not cents',
    ownership: 'resolver.ts',
  },
  {
    id: 'shopify-boatlifestyle-inr-discount',
    url: 'https://boat-lifestyle.com/products/boat-stone-nyx',
    platform: 'shopify (.js)',
    expected: { amount_minor: 149900, currency: 'INR' },
    note: 'boAt Stone Nyx speaker, ₹1499 vs struck-through ₹5990, 2 variants',
    ownership: 'resolver.ts',
  },
  {
    id: 'shopify-mamaearth-inr-multipack',
    url: 'https://mamaearth.in/products/top-to-toe-wash-for-babies-pack-of-2',
    platform: 'shopify (.js)',
    expected: { amount_minor: 99800, currency: 'INR' },
    note: 'multipack ("Pack of 2"), ₹998, no compare-at price',
    ownership: 'resolver.ts',
  },
  {
    id: 'shopify-beardo-inr-combo',
    url: 'https://beardo.in/products/godfather-bloodline-combo',
    platform: 'shopify (.js)',
    expected: { amount_minor: 109900, currency: 'INR' },
    note: 'combo bundle, ₹1099 vs struck-through ₹2497',
    ownership: 'resolver.ts',
  },
  {
    id: 'shopify-rains-eur',
    url: 'https://www.rains.com/products/water-carafe-tumbler-set',
    platform: 'shopify (.js)',
    expected: { amount_minor: 8990, currency: 'EUR' },
    note: 'Danish outerwear brand, EUR-denominated shop, €89.90, no discount',
    ownership: 'resolver.ts',
  },
  {
    id: 'shopify-havaianas-brl-discount',
    url: 'https://havaianas.com.br/products/kit-havaianas-para-presente-chinelo-slim-mini-bag-chain-cromado',
    platform: 'shopify (.js)',
    expected: { amount_minor: 13499, currency: 'BRL' },
    note: 'Brazilian storefront, R$134.99 vs struck-through R$149.98',
    ownership: 'resolver.ts',
  },
  {
    id: 'shopify-trotters-gbp-discount',
    url: 'https://www.trotters.co.uk/products/start-rite-rhino-warrior-school-shoe-in-black',
    platform: 'shopify (.js)',
    expected: { amount_minor: 2000, currency: 'GBP' },
    note: 'UK childrenswear, £20 vs struck-through £62 (11 size variants, all same price)',
    ownership: 'resolver.ts',
  },
  {
    id: 'shopify-allbirds-usd-discount',
    url: 'https://www.allbirds.com/products/womens-wool-runner-up-mizzles-hazy-indigo',
    platform: 'shopify (.js)',
    expected: { amount_minor: 6000, currency: 'USD' },
    note: '$60 vs struck-through $145, 7 size variants',
    ownership: 'resolver.ts',
  },

  // ---- structured JSON-LD / microdata (exercises parse.ts directly) ----
  {
    id: 'ikea-ae-aggregateoffer-nested',
    url: 'https://www.ikea.com/ae/en/p/dyvlinge-swivel-easy-chair-kelinge-black-00555090/',
    platform: 'custom (JSON-LD, AggregateOffer with a nested real Offer)',
    expected: { amount_minor: 39500, currency: 'AED' },
    note: 'AggregateOffer{lowPrice:395,highPrice:475} but ALSO a nested offers:[{price:395}] — the real, buyable offer, not the range, is correct here',
    ownership: 'parse.ts',
  },
  {
    id: 'ikea-jp-zero-decimal',
    url: 'https://www.ikea.com/jp/en/p/dyvlinge-swivel-easy-chair-kelinge-black-20570829/',
    platform: 'custom (JSON-LD)',
    expected: { amount_minor: 22990, currency: 'JPY' },
    note: 'zero-decimal currency: JSON-LD price "22990" means ¥22,990, not ¥229.90',
    ownership: 'parse.ts',
  },
  {
    id: 'ikea-kw-three-decimal',
    url: 'https://www.ikea.com/kw/en/p/aengsfraeken-chair-pad-black-40573054/',
    platform: 'custom (JSON-LD)',
    expected: { amount_minor: 950, currency: 'KWD' },
    note: 'three-decimal currency, price "0.95" (1 visible decimal digit)',
    ownership: 'parse.ts',
  },
  {
    id: 'ikea-bh-three-decimal',
    url: 'https://www.ikea.com/bh/en/p/bergmund-chair-black-gunnared-medium-grey-s69384307/',
    platform: 'custom (JSON-LD)',
    expected: { amount_minor: 28500, currency: 'BHD' },
    note: 'three-decimal currency, price "28.5" (1 visible decimal digit)',
    ownership: 'parse.ts',
  },
  {
    id: 'xcite-kw-microdata-three-decimal',
    url: 'https://www.xcite.com/dyson-683-pencilvac-fluffycones-vacuum-cleaner-0-8-l-492690-01-multicolor/p',
    platform: 'custom (microdata, camelCase itemProp)',
    expected: { amount_minor: 169900, currency: 'KWD' },
    note: 'Kuwaiti electronics retailer, microdata price "169.9" KWD, no JSON-LD Product on the page at all',
    ownership: 'parse.ts',
  },
  {
    id: 'woocommerce-landyachtz-aggregateoffer-range',
    url: 'https://landyachtz.com/shop/all/skate/boards/cruisers/tugboat-nightfall/',
    platform: 'woocommerce (JSON-LD, AggregateOffer — range ONLY, no nested offers)',
    expected: null,
    note: 'AggregateOffer{lowPrice:99.99,highPrice:199.99,offerCount:2}, no nested offers array at all — there is no single real price to report, refusing is correct; picking lowPrice and calling it "the price" undercharges anyone who actually wants the $199.99 variant',
    ownership: 'resolver.ts',
  },
  {
    id: 'woocommerce-jococups-pricespec-array',
    url: 'https://jococups.com/product/12oz-artist-series-black/',
    platform: 'woocommerce (JSON-LD, priceSpecification as an ARRAY)',
    expected: { amount_minor: 3995, currency: 'AUD' },
    note: 'Australian store; Offer.priceSpecification is [{...}], not {...} — offerPrice() reads spec[\'price\'] on an array and gets undefined',
    ownership: 'resolver.ts',
  },
  {
    id: 'woocommerce-homewizard-comma-decimal',
    url: 'https://www.homewizard.com/nl/shop/wi-fi-energy-socket/',
    platform: 'woocommerce (no JSON-LD/OG price on this page at all — text only)',
    expected: { amount_minor: 2795, currency: 'EUR' },
    note: 'real Dutch storefront, €27,95 in page text (comma decimal); URL path is /nl/shop/<slug>/ which the collection-path heuristic misreads as a listing page and the WHOLE resolve is rejected before parsing ever runs',
    ownership: 'resolver.ts',
  },
  {
    id: 'bigcommerce-ascolour-tee-opengraph',
    url: 'https://ascolour.com/classic-organic-tee-5026g/',
    platform: 'bigcommerce (OpenGraph only, no JSON-LD)',
    expected: { amount_minor: 2600, currency: 'USD' },
    note: 'og:type=product, product:price:amount="26" — whole-dollar amount, no decimals in the source',
    ownership: 'parse.ts',
  },
  {
    id: 'bigcommerce-ascolour-cap-opengraph',
    url: 'https://ascolour.com/access-camo-cap-1130c/',
    platform: 'bigcommerce (OpenGraph only, no JSON-LD)',
    expected: { amount_minor: 2000, currency: 'USD' },
    note: 'og:type=product, product:price:amount="20"',
    ownership: 'parse.ts',
  },
  {
    id: 'magento-ghirardelli-standard',
    url: 'https://www.ghirardelli.com/60-cacao-bittersweet-chocolate-premium-baking-chips-61274',
    platform: 'magento (JSON-LD)',
    expected: { amount_minor: 1095, currency: 'USD' },
    note: 'plain single Offer, price "10.95"',
    ownership: 'parse.ts',
  },
  {
    id: 'magento-ghirardelli-sale-discount',
    url: 'https://www.ghirardelli.com/assorted-chocolate-squares-gift-bag-1-lb-10003495',
    platform: 'magento (JSON-LD, discounted)',
    expected: { amount_minor: 2171, currency: 'USD' },
    note: 'Offer.price is the SALE price "21.71"; the page\'s own internal state elsewhere says regularPrice 28.95 — schema.org Offer.price is defined as what you actually pay, so 21.71 is correct, not a bug to "fix" toward 28.95',
    ownership: 'parse.ts',
  },
  {
    id: 'squarespace-grainandknot-number-price',
    url: 'https://www.grainandknot.com/shop/p/5-holed-lime',
    platform: 'squarespace (JSON-LD, price is a raw JSON NUMBER not a string)',
    expected: { amount_minor: 12000, currency: 'GBP' },
    note: 'Offer.price is the JSON number 120, not the string "120" — parseMoney\'s typeof-number branch has to produce the same answer as its string branch',
    ownership: 'parse.ts',
  },
  {
    id: 'wix-izzywheels-capitalized-offers',
    url: 'https://www.izzywheels.com/product-page/jurassic-world-dino-parade',
    platform: 'wix (JSON-LD key is "Offers", capital O — not schema.org-valid)',
    expected: { amount_minor: 16900, currency: 'EUR' },
    note: 'JSON-LD Product.Offers (capitalized) is invisible to offerPrice(), which reads lowercase "offers" — this fixture still resolves correctly ONLY because Wix also happens to emit valid OpenGraph product:price tags as a backfill; the JSON-LD path itself is broken',
    ownership: 'resolver.ts',
  },
  {
    id: 'wix-ogieyewear-zero-price',
    url: 'https://www.ogieyewear.com/collection/dayton',
    platform: 'wix (JSON-LD + OpenGraph both say price "0")',
    expected: null,
    note:
      'a product-line page with no fixed price, published as price "0" everywhere the merchant says anything at all. ' +
      'parse.ts now correctly refuses "0" at the source (was ownership:parse.ts until this was fixed), which is an ' +
      'improvement, but it exposes a SECOND, separate resolver.ts bug: refusing at every strategy means the ' +
      'json-ld/open-graph strategies no longer short-circuit the loop on a truthy-but-zero price, so the loop now ' +
      'reaches fromHeuristics — whose page-text regex matches "GBP9" inside a base64-encoded @font-face blob in a ' +
      '<style> tag (script tags are stripped before the regex runs, style tags are not) and, because the ISO regex\'s ' +
      '\\b...\\b cannot isolate "GBP" from the immediately-following "9", falls back to the USD default and returns a ' +
      'fabricated $9.00',
    ownership: 'resolver.ts',
  },
]
