'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, type Policy, type ProductDetail, type ShopifyTestStatus } from '@/lib/api'
import { useSession } from '@/components/session'
import { Badge, ErrorNote, Money } from '@/components/ui'
import { money } from '@/lib/format'
import { CartEditor } from './cart-editor'
import { ClaimsEditor } from './claims-editor'
import { PeopleEditor } from './people-editor'
import { PolicyEditor } from './policy-editor'
import { ProductImage } from './product-image'
import { SettingsEditor } from './settings-editor'
import { SplitPreview } from './split-preview'
import { CheckoutModePicker, HowItCompletes, type CheckoutMode } from './how-it-completes'
import {
  type DraftFee,
  type DraftItem,
  type DraftMember,
  type Role,
  type StragglerPolicy,
  claimers,
  computeSplit,
  firstMember,
  itemFromProduct,
  policyMembers,
  policyUsesWeights,
} from './model'

interface MemberPayload {
  name: string
  role: Role
  weight?: number
  backstop_cap?: number
  sponsor_for?: string
  user_id?: string
}

interface CreateResponse {
  group_id: string
  board_url: string
  members: { member_id: string; name: string; role: Role; share_amount: number; approval_page_url: string }[]
}

interface Problem {
  text: string
  fix?: { label: string; run: () => void }
}

interface BuilderDraftSnapshot {
  version: 1
  productUrl: string
  updatedAt: number
  members: DraftMember[]
  variantId: string
  items: DraftItem[]
  fees: DraftFee[]
  title: string
  policy: Policy
  deadlineMinutes: number
  toleranceBps: number
  straggler: StragglerPolicy
  noBlame: boolean
  circleId: string
  checkoutMode?: CheckoutMode
  posConfirmed?: boolean
}

const DRAFT_MAX_AGE = 7 * 24 * 60 * 60 * 1000

export function Builder({
  product,
  strategy,
  warnings,
  onBack,
}: {
  product: ProductDetail
  strategy?: string
  warnings?: string[]
  onBack: () => void
}) {
  const router = useRouter()
  const { user, friends, circles } = useSession()
  const currency = product.price.currency

  const [me] = useState<DraftMember>(() => firstMember(user))
  const [members, setMembers] = useState<DraftMember[]>(() => [me])
  const [variantId, setVariantId] = useState(
    () => product.variants.find((v) => v.available)?.id ?? product.variants[0]?.id ?? '',
  )
  const [items, setItems] = useState<DraftItem[]>(() => [itemFromProduct(product, variantId, [me.key])])
  const seedKey = useRef(items[0]?.key ?? '')
  const [fees, setFees] = useState<DraftFee[]>([])
  const [title, setTitle] = useState(product.title.slice(0, 90))
  const [policy, setPolicy] = useState<Policy>({ type: 'all_of' })
  const [deadlineMinutes, setDeadlineMinutes] = useState(60)
  const [toleranceBps, setToleranceBps] = useState(100)
  const [straggler, setStraggler] = useState<StragglerPolicy>('drop_and_continue')
  const [noBlame, setNoBlame] = useState(false)
  const [circleId, setCircleId] = useState('')
  const [checkoutMode, setCheckoutMode] = useState<CheckoutMode>('')
  const [posConfirmed, setPosConfirmed] = useState(false)
  const [shopifyTest, setShopifyTest] = useState<ShopifyTestStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [draftStatus, setDraftStatus] = useState<'checking' | 'restored' | 'saving' | 'saved'>('checking')
  const draftHydrated = useRef(false)
  const draftKey = `sutra:split-draft:v1:${product.product_url}`

  const split = useMemo(
    () => computeSplit(items, fees, members, toleranceBps),
    [items, fees, members, toleranceBps],
  )

  // The session can land after the builder mounts (deep link straight to
  // ?step=build). When it does, the first member becomes you properly.
  useEffect(() => {
    if (!user) return
    setMembers((current) =>
      current.length === 1 && !current[0].userId
        ? [{ ...current[0], name: current[0].name === 'You' ? user.name : current[0].name, userId: user.id }]
        : current,
    )
  }, [user])

  // A precise split can take time. Restore it on this device before enabling
  // autosave, so the empty initial render can never overwrite a useful draft.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(draftKey)
      if (raw) {
        const draft = JSON.parse(raw) as BuilderDraftSnapshot
        const valid =
          draft.version === 1 &&
          draft.productUrl === product.product_url &&
          Date.now() - draft.updatedAt < DRAFT_MAX_AGE &&
          Array.isArray(draft.members) &&
          Array.isArray(draft.items) &&
          draft.members.length > 0 &&
          draft.items.length > 0
        if (valid) {
          setMembers(draft.members)
          setVariantId(draft.variantId)
          setItems(draft.items)
          seedKey.current = draft.items[0]?.key ?? seedKey.current
          setFees(draft.fees ?? [])
          setTitle(draft.title)
          setPolicy(draft.policy)
          setDeadlineMinutes(draft.deadlineMinutes)
          setToleranceBps(draft.toleranceBps)
          setStraggler(draft.straggler)
          setNoBlame(draft.noBlame)
          setCircleId(draft.circleId ?? '')
          setCheckoutMode(draft.checkoutMode ?? '')
          setPosConfirmed(draft.posConfirmed ?? false)
          setDraftStatus('restored')
        } else {
          window.localStorage.removeItem(draftKey)
          setDraftStatus('saved')
        }
      } else {
        setDraftStatus('saved')
      }
    } catch {
      window.localStorage.removeItem(draftKey)
      setDraftStatus('saved')
    } finally {
      draftHydrated.current = true
    }
  }, [draftKey, product.product_url])

  useEffect(() => {
    void api.get<ShopifyTestStatus>('/v1/shopify-test/status')
      .then(setShopifyTest)
      .catch(() => setShopifyTest(null))
  }, [])

  useEffect(() => {
    if (!draftHydrated.current || busy) return
    setDraftStatus('saving')
    const timer = window.setTimeout(() => {
      const snapshot: BuilderDraftSnapshot = {
        version: 1,
        productUrl: product.product_url,
        updatedAt: Date.now(),
        members,
        variantId,
        items,
        fees,
        title,
        policy,
        deadlineMinutes,
        toleranceBps,
        straggler,
        noBlame,
        circleId,
        checkoutMode,
        posConfirmed,
      }
      try {
        window.localStorage.setItem(draftKey, JSON.stringify(snapshot))
        setDraftStatus('saved')
      } catch {
        // Private browsing and device storage limits should never block checkout.
        setDraftStatus('saved')
      }
    }, 350)
    return () => window.clearTimeout(timer)
  }, [busy, checkoutMode, circleId, deadlineMinutes, draftKey, fees, items, members, noBlame, policy, posConfirmed, product.product_url, straggler, title, toleranceBps, variantId])

  /** Members and claims move together: a line claimed by "everyone" keeps
   *  meaning everyone as the group grows, and a removed person stops claiming. */
  const handleMembers = (next: DraftMember[]) => {
    const prevAll = claimers(members).map((m) => m.key)
    const nextAll = claimers(next).map((m) => m.key)
    setMembers(next)
    setItems((current) =>
      current.map((it) => {
        const chosen = it.claimants.filter((k) => prevAll.includes(k))
        const wasEveryone = chosen.length === 0 || chosen.length === prevAll.length
        const kept = it.claimants.filter((k) => nextAll.includes(k))
        return { ...it, claimants: wasEveryone || kept.length === 0 ? nextAll : kept }
      }),
    )
  }

  const handleVariant = (id: string) => {
    setVariantId(id)
    const fresh = itemFromProduct(product, id, [])
    setItems((current) =>
      current.map((it) =>
        it.key === seedKey.current ? { ...it, sku: fresh.sku, name: fresh.name, unitAmount: fresh.unitAmount } : it,
      ),
    )
  }

  const payers = claimers(members)
  const weightTotal = payers.reduce((a, m) => a + Math.max(0, m.weight), 0)
  const testProofAvailable =
    !!shopifyTest?.enabled &&
    normaliseHost(product.merchant.domain) === normaliseHost(shopifyTest.storefront_domain ?? '')

  const problems: Problem[] = []
  if (!title.trim()) {
    problems.push({
      text: 'The group has no name. People see it before they see anything else.',
      fix: product.title.trim()
        ? { label: `Use “${product.title.slice(0, 40)}”`, run: () => setTitle(product.title.slice(0, 90)) }
        : undefined,
    })
  }
  if (members.some((m) => !m.name.trim())) {
    problems.push({ text: 'Somebody in the group has no name yet. Claims are recorded by name.' })
  }
  const lowered = members.map((m) => m.name.trim().toLowerCase()).filter(Boolean)
  if (new Set(lowered).size !== lowered.length) {
    problems.push({ text: 'Two people have the same name. Add a surname or an initial so the claims stay unambiguous.' })
  }
  if (payers.length === 0) {
    problems.push({ text: 'Nobody can pay. At least one person has to be a payer or a backstop.' })
  }
  if (items.length === 0 || split.itemsTotal <= 0) {
    problems.push({ text: 'The cart costs nothing. Give at least one line a price above zero.' })
  }
  if (items.some((it) => !it.name.trim())) {
    problems.push({ text: 'One of the lines has no description. Name it so people know what they are approving.' })
  }
  if (!checkoutMode) {
    problems.push({ text: 'Choose how the merchant will actually be paid. A product link alone is not a payment integration.' })
  }
  if (checkoutMode === 'shopify_pos' && !posConfirmed) {
    problems.push({ text: 'Confirm that this specific physical location can take split payments in Shopify POS.' })
  }
  if (checkoutMode === 'shopify_test_order' && !testProofAvailable) {
    problems.push({ text: 'This product is not from the configured Shopify development store.' })
  }
  if (
    checkoutMode !== 'shopify_test_order' &&
    members.some((member) => member.role === 'backstop' || member.role === 'sponsor')
  ) {
    problems.push({
      text: 'Backstops and sponsors require a verified payment adapter. Use payers/observers for a POS or checkout handoff.',
    })
  }
  const sponsorless = members.filter((m) => m.role === 'sponsor' && !m.sponsorFor)
  if (sponsorless.length > 0) {
    problems.push({
      text: `${sponsorless[0].name || 'A sponsor'} is a sponsor but is not covering anybody. Pick someone, or make them a payer.`,
    })
  }
  const namesNow = new Set(members.map((m) => m.name.trim()).filter(Boolean))
  for (const n of new Set(policyMembers(policy))) {
    if (!n) problems.push({ text: 'The policy singles out a person, but no person is chosen yet.' })
    else if (!namesNow.has(n)) {
      problems.push({ text: `The policy names ${n}, who is not in the group any more. Choose somebody else.` })
    }
  }
  if (policy.type === 'quorum' && policy.m > payers.length) {
    problems.push({
      text: `The rule needs ${policy.m} approvals, but only ${payers.length} ${payers.length === 1 ? 'person' : 'people'} can approve.`,
      fix: { label: `Ask for ${payers.length}`, run: () => setPolicy({ type: 'quorum', m: Math.max(1, payers.length) }) },
    })
  }
  if (policy.type === 'weighted' && policy.threshold > weightTotal) {
    problems.push({
      text: `The rule needs ${policy.threshold} of weight, and everyone together is worth ${weightTotal}.`,
      fix: {
        label: `Ask for ${Math.max(1, weightTotal)}`,
        run: () => setPolicy({ type: 'weighted', threshold: Math.max(1, weightTotal) }),
      },
    })
  }

  const ready = problems.length === 0 && !busy

  const create = async () => {
    if (!ready) return
    setBusy(true)
    setError('')
    const nameOf = (key: string) => members.find((m) => m.key === key)?.name.trim() ?? ''
    const eligKeys = payers.map((m) => m.key)

    const cartItems = items.map((it) => {
      const chosen = it.claimants.filter((k) => eligKeys.includes(k))
      const list = chosen.length > 0 ? chosen : eligKeys
      const everyone = members.length === list.length && members.every((m) => list.includes(m.key))
      return {
        sku: it.sku || it.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || 'line',
        name: it.name.trim(),
        unit_amount: it.unitAmount,
        qty: it.qty,
        tier: it.tier,
        claimants: everyone ? ['mi_all'] : list.map(nameOf).filter(Boolean),
        contested: list.length > it.qty,
      }
    })

    const usesWeights = policyUsesWeights(policy)
    const memberPayload: MemberPayload[] = members.map((m) => {
      const out: MemberPayload = { name: m.name.trim(), role: m.role }
      if (usesWeights && m.role !== 'observer') out.weight = m.weight
      if (m.role === 'backstop') out.backstop_cap = m.backstopCap
      if (m.role === 'sponsor' && m.sponsorFor) out.sponsor_for = nameOf(m.sponsorFor)
      if (m.userId) out.user_id = m.userId
      return out
    })

    try {
      const res = await api.post<CreateResponse>('/v1/groups', {
        title: title.trim(),
        merchant: {
          id: product.merchant.domain,
          name: product.merchant.name,
          url: product.merchant.url,
          country_code_iso2: product.merchant.country_code_iso2,
        },
        cart: { items: cartItems, fees: fees.map((f) => ({ name: f.name.trim() || 'Fee', amount: f.amount })), currency },
        members: memberPayload,
        policy,
        tolerance_bps: toleranceBps,
        straggler_policy: straggler,
        no_blame: noBlame,
        deadline_minutes: deadlineMinutes,
        created_by: user?.id,
        circle_id: circleId || undefined,
        rail: checkoutMode === 'shopify_test_order' ? 'prava_mandates' : checkoutMode,
        origin: checkoutMode === 'shopify_test_order' ? 'shopify_test' : 'discover',
        product: { ...product, checkout_mode: checkoutMode },
      })
      window.localStorage.removeItem(draftKey)
      router.push(`/app/groups/${res.group_id}`)
    } catch (e) {
      setError(
        (e as Error).message ||
          'The engine would not take that group. Nothing was created and nobody was contacted.',
      )
      setBusy(false)
    }
  }

  const createLabel = checkoutMode === 'shopify_pos'
    ? 'Create Shopify POS split'
    : checkoutMode === 'shopify_test_order'
      ? 'Start Shopify test-order proof'
    : checkoutMode === 'checkout_handoff'
      ? 'Prepare checkout handoff'
      : 'Choose a finish line'

  const createButton = (
    <button type="button" className="btn btn-primary btn-block btn-lg" disabled={!ready} onClick={() => void create()}>
      {busy ? 'Creating…' : `${createLabel} · ${money(split.total, currency)}`}
    </button>
  )

  const resetDraft = () => {
    const defaultVariant = product.variants.find((variant) => variant.available)?.id ?? product.variants[0]?.id ?? ''
    const freshItem = itemFromProduct(product, defaultVariant, [me.key])
    window.localStorage.removeItem(draftKey)
    setMembers([{ ...me, name: user?.name ?? me.name, userId: user?.id ?? me.userId }])
    setVariantId(defaultVariant)
    setItems([freshItem])
    seedKey.current = freshItem.key
    setFees([])
    setTitle(product.title.slice(0, 90))
    setPolicy({ type: 'all_of' })
    setDeadlineMinutes(60)
    setToleranceBps(100)
    setStraggler('drop_and_continue')
    setNoBlame(false)
    setCircleId('')
    setCheckoutMode('')
    setPosConfirmed(false)
    setError('')
    setDraftStatus('saved')
  }

  return (
    <div className="col" style={{ gap: 18 }}>
      <div className="draft-bar" role="status">
        <span className={draftStatus === 'saving' || draftStatus === 'checking' ? 'dot dot-warn' : 'dot dot-ok'} />
        <span>
          {draftStatus === 'checking'
            ? 'Checking for a saved split…'
            : draftStatus === 'restored'
              ? 'Restored your unfinished split from this device.'
              : draftStatus === 'saving'
                ? 'Saving this split…'
                : 'This split is saved on this device.'}
        </span>
        <button type="button" className="text-button" onClick={resetDraft}>Start over</button>
      </div>
      <div className="card card-pad">
        <div className="row wrap" style={{ gap: 14, alignItems: 'flex-start' }}>
          <div style={{ width: 92, flex: 'none' }}>
            <ProductImage
              src={product.images[0] ?? product.image_url}
              alt={product.title}
              domain={product.merchant.domain}
              ratio="1 / 1"
              radius="var(--r)"
            />
          </div>
          <div className="grow col" style={{ gap: 8, minWidth: 200 }}>
            <div className="row wrap" style={{ gap: 8 }}>
              {product.merchant.domain && <span className="mono tiny faint">{product.merchant.domain}</span>}
              {product.brand && <Badge>{product.brand}</Badge>}
              {!product.in_stock && <Badge tone="warn">out of stock</Badge>}
              {strategy && <Badge>read via {strategy}</Badge>}
            </div>
            <label className="field">
              <span className="field-label">Group name</span>
              <input
                className="input input-lg"
                value={title}
                maxLength={120}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What is this group buying?"
              />
            </label>
            <div className="row wrap" style={{ gap: 12 }}>
              {product.product_url && (
                <a className="btn btn-ghost" href={product.product_url} target="_blank" rel="noreferrer noopener">
                  View on {product.merchant.domain} ↗
                </a>
              )}
              <button type="button" className="btn btn-ghost" onClick={onBack}>
                ← Choose something else
              </button>
            </div>
          </div>
          <div className="col" style={{ alignItems: 'flex-end', gap: 2 }}>
            <Money minor={product.price.amount_minor} currency={currency} size="lg" />
            <span className="tiny faint">{product.unit_label}</span>
          </div>
        </div>

        {warnings && warnings.length > 0 && (
          <p className="tiny faint" style={{ marginTop: 12, lineHeight: 1.6 }}>
            {warnings.map((w, i) => (
              <span key={i} style={{ display: 'block' }}>
                Note while reading the page: {w}
              </span>
            ))}
          </p>
        )}

        {product.fine_print.length > 0 && (
          <p className="tiny faint" style={{ marginTop: 8 }}>
            {product.fine_print.join(' · ')}
          </p>
        )}
      </div>

      <div className="row" style={{ gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div className="col" style={{ gap: 18, flex: '3 1 440px', minWidth: 0 }}>
          <CartEditor
            product={product}
            variantId={variantId}
            onVariant={handleVariant}
            items={items}
            fees={fees}
            currency={currency}
            itemsTotal={split.itemsTotal}
            feesTotal={split.feesTotal}
            onItems={setItems}
            onFees={setFees}
          />

          <PeopleEditor
            members={members}
            onMembers={handleMembers}
            friends={friends}
            circles={circles}
            currency={currency}
            meId={user?.id}
            circleId={circleId}
            onCircle={setCircleId}
          />

          <ClaimsEditor items={items} members={members} currency={currency} onItems={setItems} />

          <PolicyEditor policy={policy} onPolicy={setPolicy} members={members} onMembers={handleMembers} />

          <SettingsEditor
            deadlineMinutes={deadlineMinutes}
            onDeadline={setDeadlineMinutes}
            toleranceBps={toleranceBps}
            onTolerance={setToleranceBps}
            straggler={straggler}
            onStraggler={setStraggler}
            noBlame={noBlame}
            onNoBlame={setNoBlame}
            sampleShare={split.shares.find((s) => s.payable > 0)?.payable ?? Math.round(split.total / Math.max(1, payers.length))}
            currency={currency}
            charges={checkoutMode === 'shopify_test_order'}
          />

          <CheckoutModePicker
            value={checkoutMode}
            onChange={setCheckoutMode}
            isShopify={product.source === 'shopify' || strategy === 'shopify-json'}
            testProof={{
              available: testProofAvailable,
              adapter: shopifyTest?.adapter ?? 'mock',
              store: shopifyTest?.storefront_domain ?? null,
            }}
            posConfirmed={posConfirmed}
            onPosConfirmed={setPosConfirmed}
          />
        </div>

        <div className="col" style={{ gap: 14, flex: '1 1 300px', minWidth: 0, position: 'sticky', top: 70 }}>
          <SplitPreview
            split={split}
            currency={currency}
            toleranceBps={toleranceBps}
            charges={checkoutMode === 'shopify_test_order'}
          />

          {/* Says whether this split can actually complete before anybody is
              asked to approve it, rather than after. The two cases are
              genuinely different and the app can tell them apart. */}
          <HowItCompletes
            mode={checkoutMode}
            merchant={product.merchant.name}
            people={Math.max(1, payers.length)}
          />

          <div className="card card-pad col" style={{ gap: 12 }}>
            {checkoutMode === 'shopify_test_order' ? (
              <p className="guardrail">
                Test mode only. Sutra test approvals are mirrored into a valid Shopify test order after you add
                the delivery address. No real money moves.
              </p>
            ) : checkoutMode === 'shopify_pos' ? (
              <p className="guardrail">
                Nothing is charged through sutra. Each person confirms their exact share, then pays{' '}
                <b>{product.merchant.name}</b> directly at Shopify POS.
              </p>
            ) : checkoutMode === 'checkout_handoff' ? (
              <p className="guardrail">
                Nothing is charged and no order is placed through sutra. This records the proposed split before the{' '}
                <b>{product.merchant.name}</b> checkout handoff.
              </p>
            ) : (
              <p className="guardrail">Choose a finish line above. No one can be invited until the payment path is explicit.</p>
            )}

            {problems.length > 0 && (
              <div className="col" style={{ gap: 8 }}>
                {problems.slice(0, 4).map((p, i) => (
                  <div key={i} className="row wrap" style={{ gap: 8, alignItems: 'flex-start' }}>
                    <span className="tiny" style={{ color: 'var(--warn)', lineHeight: 1.5 }}>
                      {p.text}
                    </span>
                    {p.fix && (
                      <button type="button" className="btn btn-secondary tiny" onClick={p.fix.run}>
                        {p.fix.label}
                      </button>
                    )}
                  </div>
                ))}
                {problems.length > 4 && (
                  <span className="tiny faint">and {problems.length - 4} more to fix.</span>
                )}
              </div>
            )}

            {error && (
              <ErrorNote>
                {error} Nothing was created and nobody has been asked for money — fix the detail above and try
                again.
              </ErrorNote>
            )}

            {createButton}

            <p className="tiny faint" style={{ lineHeight: 1.55 }}>
              {checkoutMode === 'shopify_test_order'
                ? 'Creating the group sends test approval links. The Shopify order is created only after every test share succeeds and you supply the delivery address.'
                : 'Creating the group only sends agreement links. Sutra does not place the merchant order or charge a card on this finish line.'}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function normaliseHost(value: string): string {
  return value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '')
}
