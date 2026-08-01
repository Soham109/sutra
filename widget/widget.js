/* sutra widget — "Split this with Prava" in one script tag (spec §14).
 *
 * <script src="https://ENGINE/widget.js"
 *   data-gmp-title="Ratatat — 4 tickets"
 *   data-gmp-merchant="Velvet Ticket Co."
 *   data-gmp-item="GA ticket" data-gmp-price="45.00" data-gmp-qty="4"
 *   data-gmp-members="Soham,Arsh,Dev,Maya"
 *   data-gmp-token="dev-token"></script>
 *
 * Renders a button where the tag sits; click → group exists → QR sheet opens.
 * Under 150 lines, zero dependencies, framework-agnostic.
 */
;(() => {
  const script = document.currentScript
  if (!script) return
  const ds = script.dataset
  const base = new URL(script.src).origin

  const btn = document.createElement('button')
  btn.textContent = '⚡ Split this with Prava'
  Object.assign(btn.style, {
    padding: '14px 22px',
    borderRadius: '12px',
    border: '0',
    background: '#f59e0b',
    color: '#14100a',
    fontSize: '16px',
    fontWeight: '700',
    cursor: 'pointer',
    fontFamily: 'system-ui, sans-serif',
  })
  script.parentNode.insertBefore(btn, script)

  const minor = (s) => Math.round(Number(s || 0) * 100)

  btn.addEventListener('click', async () => {
    btn.disabled = true
    btn.textContent = 'Creating group…'
    try {
      const members = (ds.gmpMembers || 'Member 1,Member 2')
        .split(',')
        .map((n) => ({ name: n.trim(), role: 'payer' }))
      const res = await fetch(`${base}/v1/groups`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${ds.gmpToken || 'dev-token'}`,
        },
        body: JSON.stringify({
          title: ds.gmpTitle || document.title,
          merchant: {
            id: 'widget',
            name: ds.gmpMerchant || location.hostname || 'Merchant',
            url: 'https://' + (location.hostname || 'example-merchant.test'),
            country_code_iso2: 'US',
          },
          cart: {
            items: [
              {
                sku: 'widget-item',
                name: ds.gmpItem || 'Item',
                unit_amount: minor(ds.gmpPrice || '10'),
                qty: Number(ds.gmpQty || members.length),
                claimants: ['mi_all'],
              },
            ],
            fees: [],
            currency: ds.gmpCurrency || 'USD',
          },
          members,
          policy: { type: 'all_of' },
          deadline_minutes: Number(ds.gmpDeadline || 60),
        }),
      })
      if (!res.ok) throw new Error(`engine said ${res.status}`)
      const group = await res.json()
      window.open(`${base}/g/${group.group_id}/share`, '_blank', 'width=900,height=700')
      btn.textContent = '✓ Group live — QR sheet opened'
    } catch (e) {
      btn.textContent = `Failed: ${e.message}`
      btn.disabled = false
    }
  })
})()
