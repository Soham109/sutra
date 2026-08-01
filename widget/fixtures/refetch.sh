#!/usr/bin/env bash
# Re-capture the fixtures from the live web. They will drift — that is the
# point of keeping the URLs next to them in SOURCES.json. Run from repo root:
#   bash widget/fixtures/refetch.sh
set -u
cd "$(dirname "$0")"
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

get() {
  curl -sL --max-time 45 -A "$UA" \
    -H "accept-language: en-US,en;q=0.9" \
    -H "accept: text/html,application/xhtml+xml" \
    "$2" -o "$1" -w "%{http_code}  %{size_download}b  $1\n"
}

get shopify-allbirds-product.html "https://www.allbirds.com/products/mens-allbirds-flip-flop-anthracite"
get shopify-india-product.html    "https://www.bombayshavingcompany.com/products/air-trimmer"
get eventbrite-tour.html          "https://www.eventbrite.com/e/chelsea-market-high-line-hudson-yards-food-history-tour-tickets-1993686741713"
get ikea-product.html             "https://www.ikea.com/us/en/p/billy-bookcase-blue-40594928/"
get nike-product.html             "https://www.nike.com/t/air-force-1-07-mens-shoes-jBrhbr/CW2288-111"
get cardekho.html                 "https://www.cardekho.com/tata/nexon"
get bandcamp.html                 "https://music.monstercat.com/album/monstercat-uncaged-vol-1"
get craigslist.html               "https://www.craigslist.org/search/area/newyork?cat=sss&query=bicycle"
get berkeley-coa.html             "https://financialaid.berkeley.edu/how-aid-works/student-budgets-cost-of-attendance/"
get wikipedia-negative.html       "https://en.wikipedia.org/wiki/Movie_theater"

echo
echo "Fixtures refreshed. Expect detect.test.mjs assertions to need updating —"
echo "prices change. Run: node --test widget/detect.test.mjs"
