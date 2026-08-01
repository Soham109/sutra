// Offline Prava simulator. Implements the same lifecycle semantics the real
// sandbox enforces (pending → active on passkey, caps, idempotent charges,
// consumed on APPROVED report) so the whole demo — and the chaos suite —
// runs with zero network and zero test-card burn.
import { randomBytes } from 'node:crypto'
import type {
  ChargeOutcome,
  CreateMandateSessionInput,
  MandateCharge,
  MandateSession,
  MandateSummary,
  PravaAdapter,
  PravaMandateStatus,
  ReportOutcome,
} from './adapter.js'

interface MockMandate {
  id: string
  sessionId: string
  customerId: string
  status: PravaMandateStatus
  merchantName: string
  approvedAmount: string // cap, decimal string
  currency: string
  createdAt: string
}

interface MockCharge {
  transactionId: string
  mandateId: string
  amount: string
  reference: string
  status: 'awaiting_result' | 'completed' | 'failed'
  createdAt: string
}

/** Mirrors PravaHttpError's shape so the engine's terminal-error check works. */
export class MockPravaError extends Error {
  readonly terminal = true
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(`Prava ${status} ${code}: ${message}`)
  }
}

interface MockSession {
  id: string
  mandateId: string
  customerId: string
  merchantName: string
  amount: string
  currency: string
  products: { description: string; unit_price: string; quantity: number }[]
  callbackUrl?: string
}

const rid = (prefix: string) => `${prefix}_${randomBytes(8).toString('hex')}`

export class MockPrava implements PravaAdapter {
  readonly kind = 'mock' as const

  private readonly mandates = new Map<string, MockMandate>()
  private readonly sessions = new Map<string, MockSession>()
  private readonly charges = new Map<string, MockCharge>() // by transactionId
  private readonly chargesByRef = new Map<string, MockCharge>() // mandateId|reference
  /** customerIds whose next charge should be declined (chaos / demo run two). */
  private readonly declineCharges = new Set<string>()

  constructor(private readonly appBaseUrl: string) {}

  async createMandateSession(input: CreateMandateSessionInput): Promise<MandateSession> {
    const sessionId = rid('sess')
    const mandateId = rid('mdt')
    this.mandates.set(mandateId, {
      id: mandateId,
      sessionId,
      customerId: input.userId,
      status: 'pending',
      merchantName: input.merchant.name,
      approvedAmount: input.totalAmount,
      currency: input.currency,
      createdAt: new Date().toISOString(),
    })
    this.sessions.set(sessionId, {
      id: sessionId,
      mandateId,
      customerId: input.userId,
      merchantName: input.merchant.name,
      amount: input.totalAmount,
      currency: input.currency,
      products: input.products,
      callbackUrl: input.callbackUrl,
    })
    return {
      sessionId,
      approvalUrl: `${this.appBaseUrl}/mock/pay/${sessionId}`,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      orderId: rid('ord'),
    }
  }

  async listMandates(customerId: string): Promise<MandateSummary[]> {
    return [...this.mandates.values()]
      .filter((m) => m.customerId === customerId)
      .map(summary)
      .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
  }

  async getMandate(mandateId: string): Promise<MandateSummary | null> {
    const m = this.mandates.get(mandateId)
    return m ? summary(m) : null
  }

  async getMandateCharges(mandateId: string): Promise<MandateCharge[]> {
    return [...this.charges.values()]
      .filter((c) => c.mandateId === mandateId)
      .map((c) => ({
        transactionId: c.transactionId,
        amount: c.amount,
        status: c.status,
        reference: c.reference,
        createdAt: c.createdAt,
      }))
  }

  async chargeMandate(mandateId: string, amount: string, reference: string): Promise<ChargeOutcome> {
    const refKey = `${mandateId}|${reference}`
    const existing = this.chargesByRef.get(refKey)
    if (existing) {
      return { status: 'awaiting_result', transactionId: existing.transactionId, deduplicated: true }
    }
    const m = this.mandates.get(mandateId)
    if (!m) {
      return { status: 'failed', transactionId: null, errorCode: 'MANDATE_NOT_FOUND', terminal: true }
    }
    if (m.status !== 'active') {
      // Real API: 409 error envelope, not a 200 body. Throwing keeps the engine
      // on the same code path it will take in sandbox.
      throw new MockPravaError(409, 'MANDATE_NOT_ACTIVE', `mandate is ${m.status}`)
    }
    if (cents(amount) > cents(m.approvedAmount)) {
      // Over-cap declines come back 200 with the reason in errorMessage and no
      // errorCode — mirroring that is how we know our surfaces read the right
      // field when a real network decline lands.
      return {
        status: 'failed',
        transactionId: null,
        errorMessage: 'THRESHOLD_EXCEEDED',
        terminal: true,
      }
    }
    if (this.declineCharges.has(m.customerId)) {
      this.declineCharges.delete(m.customerId)
      const failed: MockCharge = {
        transactionId: rid('txn'), mandateId, amount, reference,
        status: 'failed', createdAt: new Date().toISOString(),
      }
      this.charges.set(failed.transactionId, failed)
      // Deliberately NOT recorded in chargesByRef: "a failed charge clears its
      // key, so a retry after failure is not deduplicated". A mock stricter
      // than the API would prove an idempotency invariant we do not actually
      // have.
      return {
        status: 'failed',
        transactionId: failed.transactionId,
        errorMessage: 'issuer declined (simulated)',
        terminal: true,
      }
    }
    const charge: MockCharge = {
      transactionId: rid('txn'), mandateId, amount, reference,
      status: 'awaiting_result', createdAt: new Date().toISOString(),
    }
    this.charges.set(charge.transactionId, charge)
    this.chargesByRef.set(refKey, charge)
    return { status: 'awaiting_result', transactionId: charge.transactionId }
  }

  async reportCharge(
    mandateId: string,
    transactionId: string,
    txnStatus: 'APPROVED' | 'DECLINED',
  ): Promise<ReportOutcome> {
    const charge = this.charges.get(transactionId)
    const m = this.mandates.get(mandateId)
    if (!charge || !m) {
      return { status: 'failed', mandateStatus: m?.status ?? 'unknown', settled: false }
    }
    if (txnStatus === 'APPROVED') {
      charge.status = 'completed'
      m.status = 'consumed' // one-time mandates are consumed by an APPROVED report
      return {
        status: 'completed',
        mandateStatus: 'consumed',
        visaConfirmation: 'SUCCESS',
        settled: true,
      }
    }
    charge.status = 'failed'
    return { status: 'failed', mandateStatus: m.status, visaConfirmation: 'FAILURE', settled: false }
  }

  async cancelMandate(mandateId: string): Promise<void> {
    const m = this.mandates.get(mandateId)
    // Cancel is documented only from active/paused. A pending mandate stays
    // pending — which is exactly why cleanup revokes the session as well.
    if (m && (m.status === 'active' || m.status === 'paused')) m.status = 'cancelled'
  }

  async pauseMandate(mandateId: string): Promise<void> {
    const m = this.mandates.get(mandateId)
    if (m && m.status === 'active') m.status = 'paused'
  }

  async resumeMandate(mandateId: string): Promise<void> {
    const m = this.mandates.get(mandateId)
    if (m && m.status === 'paused') m.status = 'active'
  }

  /**
   * Revoking a session kills the approval page. Prava's docs do not say what
   * happens to a mandate still pending against it, so the simulator takes the
   * pessimistic reading — the mandate is left alone and only the session dies.
   * Anything that must guarantee a pending mandate is dead has to say so.
   */
  async revokeSession(sessionId: string): Promise<void> {
    const s = this.sessions.get(sessionId)
    if (!s) return
    this.sessions.delete(sessionId)
    const m = this.mandates.get(s.mandateId)
    if (m && m.status === 'pending') m.status = 'expired'
  }

  // ---- simulator-only surface (drives the fake hosted ceremony) -----------

  getSession(sessionId: string): MockSession | undefined {
    return this.sessions.get(sessionId)
  }

  /** The passkey button on the fake hosted page. pending → active. */
  approveSession(sessionId: string): boolean {
    const s = this.sessions.get(sessionId)
    if (!s) return false
    const m = this.mandates.get(s.mandateId)
    if (!m || m.status !== 'pending') return false
    m.status = 'active'
    return true
  }

  /** Simulate a member cancelling from their own Prava portal (§6.2). */
  cancelByCustomer(customerId: string): void {
    for (const m of this.mandates.values()) {
      if (m.customerId === customerId && (m.status === 'active' || m.status === 'pending')) {
        m.status = 'cancelled'
      }
    }
  }

  /** Demo run two / chaos: the next charge for this customer is declined. */
  declineNextChargeFor(customerId: string): void {
    this.declineCharges.add(customerId)
  }

  /** Ground truth for the chaos invariant checker — what Prava actually saw. */
  debugState(): {
    mandates: { id: string; customerId: string; status: string; cap: number }[]
    charges: { transactionId: string; mandateId: string; amount: number; reference: string; status: string }[]
  } {
    return {
      mandates: [...this.mandates.values()].map((m) => ({
        id: m.id,
        customerId: m.customerId,
        status: m.status,
        cap: cents(m.approvedAmount),
      })),
      charges: [...this.charges.values()].map((c) => ({
        transactionId: c.transactionId,
        mandateId: c.mandateId,
        amount: cents(c.amount),
        reference: c.reference,
        status: c.status,
      })),
    }
  }
}

function summary(m: MockMandate): MandateSummary {
  return {
    id: m.id,
    status: m.status,
    merchantName: m.merchantName,
    approvedAmount: m.approvedAmount,
    currency: m.currency,
    createdAt: m.createdAt,
    state: m.status === 'active' ? 'available' : m.status === 'consumed' ? 'consumed' : 'expired',
  }
}

function cents(decimal: string): number {
  const [whole = '0', frac = ''] = decimal.split('.')
  return Number(whole) * 100 + Number((frac + '00').slice(0, 2))
}
