'use client'

import { useState } from 'react'
import { api, type Group, type ShopifyTestOrderProof } from '@/lib/api'
import { ErrorNote, Money } from '@/components/ui'

const EMPTY = {
  email: 'demo@example.com',
  first_name: '',
  last_name: '',
  address1: '',
  address2: '',
  city: '',
  province_code: '',
  country_code: 'IN',
  zip: '',
  phone: '',
}

export function ShopifyTestProof({ group }: { group: Group }) {
  const [proof, setProof] = useState(group.shopify_test_order)
  const [form, setForm] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (group.origin !== 'shopify_test' || group.rail !== 'prava_mandates') return null

  if (proof) return <ProofCard proof={proof} />

  const ready =
    group.status === 'committed' &&
    form.email.includes('@') &&
    form.first_name.trim() &&
    form.last_name.trim() &&
    form.address1.trim() &&
    form.city.trim() &&
    form.country_code.trim().length === 2 &&
    form.zip.trim()

  const create = async () => {
    if (!ready || busy) return
    setBusy(true)
    setError('')
    try {
      const created = await api.post<ShopifyTestOrderProof>(
        `/v1/groups/${group.group_id}/shopify-test-order`,
        {
          email: form.email.trim(),
          shipping_address: {
            first_name: form.first_name.trim(),
            last_name: form.last_name.trim(),
            address1: form.address1.trim(),
            address2: form.address2.trim() || undefined,
            city: form.city.trim(),
            province_code: form.province_code.trim() || undefined,
            country_code: form.country_code.trim().toUpperCase(),
            zip: form.zip.trim(),
            phone: form.phone.trim() || undefined,
          },
        },
      )
      setProof(created)
    } catch (caught) {
      setError((caught as Error).message)
      setBusy(false)
    }
  }

  return (
    <section className="card card-pad shopify-proof">
      <div className="row-between wrap" style={{ gap: 12 }}>
        <div>
          <span className="eyebrow">Shopify development-store proof</span>
          <h3 style={{ marginTop: 5 }}>Create the independently visible test order</h3>
        </div>
        <span className="badge badge-warn">TEST · ₹0 real money</span>
      </div>

      {group.status !== 'committed' ? (
        <div className="well" style={{ marginTop: 14 }}>
          <b>Finish every Sutra test approval first.</b>
          <p className="small muted" style={{ marginTop: 5 }}>
            The address and Shopify action unlock only after the group receipt proves every test share completed.
          </p>
        </div>
      ) : (
        <>
          <p className="small muted" style={{ marginTop: 10 }}>
            This address is sent straight to your configured Shopify development store and is not stored in Sutra.
            Use fictional demo details—never a judge&apos;s real address.
          </p>
          <div className="shopify-proof-form">
            <Field label="Receipt email" value={form.email} type="email" onChange={(email) => setForm({ ...form, email })} />
            <Field label="First name" value={form.first_name} onChange={(first_name) => setForm({ ...form, first_name })} />
            <Field label="Last name" value={form.last_name} onChange={(last_name) => setForm({ ...form, last_name })} />
            <Field label="Address" value={form.address1} onChange={(address1) => setForm({ ...form, address1 })} wide />
            <Field label="Apartment / unit (optional)" value={form.address2} onChange={(address2) => setForm({ ...form, address2 })} wide />
            <Field label="City" value={form.city} onChange={(city) => setForm({ ...form, city })} />
            <Field label="State code" value={form.province_code} onChange={(province_code) => setForm({ ...form, province_code })} placeholder="KA" />
            <Field label="Country code" value={form.country_code} onChange={(country_code) => setForm({ ...form, country_code })} placeholder="IN" />
            <Field label="PIN / ZIP" value={form.zip} onChange={(zip) => setForm({ ...form, zip })} />
          </div>

          {error && <ErrorNote>{error}</ErrorNote>}

          <button type="button" className="btn btn-primary btn-lg" disabled={!ready || busy} onClick={() => void create()}>
            {busy ? 'Creating Shopify test order…' : 'Create valid Shopify test order'}
          </button>
          <p className="tiny faint" style={{ marginTop: 10, lineHeight: 1.55 }}>
            Shopify receives <code>test: true</code> on the order and every participant transaction. This proves the
            adapter and reconciliation—not that ordinary Shopify Checkout accepted several cards.
          </p>
        </>
      )}
    </section>
  )
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  wide = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  placeholder?: string
  wide?: boolean
}) {
  return (
    <label className={`field${wide ? ' is-wide' : ''}`}>
      <span className="field-label">{label}</span>
      <input
        className="input"
        value={value}
        type={type}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

function ProofCard({ proof }: { proof: ShopifyTestOrderProof }) {
  return (
    <section className="card card-pad shopify-proof is-complete">
      <div className="row-between wrap" style={{ gap: 12 }}>
        <div>
          <span className="eyebrow">Shopify independently confirms it</span>
          <h3 style={{ marginTop: 5 }}>{proof.order_name} · valid test order</h3>
        </div>
        <span className="badge badge-ok">TEST · {proof.financial_status}</span>
      </div>
      <div className="shopify-proof-stats">
        <div><span>Total</span><Money minor={proof.total_minor} currency={proof.currency} /></div>
        <div><span>Participant transactions</span><b>{proof.transaction_count}</b></div>
        <div><span>Store</span><b className="mono tiny">{proof.store_domain}</b></div>
      </div>
      <p className="small muted">{proof.disclosure}</p>
      <a className="btn btn-primary" href={proof.admin_url} target="_blank" rel="noreferrer noopener">
        Verify in Shopify admin ↗
      </a>
    </section>
  )
}
