// Turn the full product captures into focused, judge-readable README frames.
//
// The source images are produced by capture.mjs from the real app. This script
// only crops and losslessly recompresses them; it never changes text, numbers,
// state, or browser chrome. Keeping this separate makes the presentation edits
// reproducible and leaves the full captures available for audit.
//
//   node docs/screenshots/prepare-readme.mjs


import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const here = dirname(fileURLToPath(import.meta.url))

const frames = [
  {
    source: '01-landing-light.png',
    output: 'readme-hero.png',
    // Preserve the complete hero, trim only the empty tail below the fold.
    crop: { left: 0, top: 0, width: 2880, height: 1620 },
  },
  {
    source: '03-discover-search-light.png',
    output: 'readme-discover.png',
    // Search query, provenance copy, product facts, price and split action.
    crop: { left: 390, top: 100, width: 2320, height: 1305 },
  },
  {
    source: '04-bill-parsed-light.png',
    output: 'readme-bill.png',
    // Receipt text, reconciliation, claimants and exact per-person totals.
    crop: { left: 350, top: 70, width: 2380, height: 1339 },
  },
  {
    source: '06-approval-pending-light.png',
    output: 'readme-approval.png',
    // The complete decision surface. Its portrait ratio is intentional.
    crop: { left: 875, top: 45, width: 1130, height: 1695 },
  },
  {
    source: '08-nanda-light.png',
    output: 'readme-nanda.png',
    // The live discovery chain and the response cards it is based on.
    crop: { left: 620, top: 470, width: 1680, height: 945 },
  },
  {
    source: '09-plan-board-light.png',
    output: 'readme-plan.png',
    // Intent, participants, live OSM options and the start of the ranked list.
    crop: { left: 500, top: 55, width: 2150, height: 1209 },
  },
]

for (const frame of frames) {
  const source = join(here, frame.source)
  const output = join(here, frame.output)
  if (!existsSync(source)) throw new Error(`Missing source capture: ${frame.source}`)

  const meta = await sharp(source).metadata()
  const { left, top, width, height } = frame.crop
  if (!meta.width || !meta.height || left + width > meta.width || top + height > meta.height) {
    throw new Error(
      `${frame.output}: crop ${JSON.stringify(frame.crop)} exceeds ${meta.width}x${meta.height}`,
    )
  }

  await sharp(source)
    .extract(frame.crop)
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(output)

  console.log(`${frame.output.padEnd(24)} <- ${frame.source} (${width}x${height})`)
}
