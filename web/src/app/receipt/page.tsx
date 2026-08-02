import { redirect } from 'next/navigation'

/**
 * A short, memorable URL for the one completed card-rail charge.
 *
 * `/app/receipts/gs_01KZ…` is fine to link from inside the product but is not
 * something anyone can read out or type. This redirects to whichever group is
 * configured as the proven charge, so the shareable link stays `/receipt` even
 * if a better run replaces it later.
 */
const GROUP = process.env.NEXT_PUBLIC_PROVEN_CHARGE_GROUP ?? 'gs_01KZ1SW0EXN2V3N4Y1V0K5E4H4'

export default function ReceiptShortcut() {
  redirect(`/app/receipts/${GROUP}`)
}
