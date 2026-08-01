// The engine's view of Prava. Everything the protocol needs, nothing more.
// Implemented by the real REST client (client.ts), the offline simulator
// (mock.ts), and the fault-injecting chaos proxy (chaos.ts).

export type PravaMandateStatus =
  | 'pending'
  | 'active'
  | 'paused'
  | 'consumed'
  | 'cancelled'
  | 'expired'

export interface CreateMandateSessionInput {
  userId: string // our member intent id — unique per member, used as customer_id
  userEmail: string
  totalAmount: string // decimal string; the member's cap
  currency: string
  merchant: { name: string; url: string; country_code_iso2: string }
  products: { description: string; unit_price: string; quantity: number }[]
  description: string
  callbackUrl?: string
  effectiveUntilMinutes?: number
  /** Our own reconciliation handle, echoed back by Prava. */
  externalOrderRef?: string
}

export interface MandateSession {
  sessionId: string
  approvalUrl: string // Prava's `iframe_url` — the hosted passkey ceremony
  expiresAt: string
  orderId?: string | null
}

export interface MandateSummary {
  id: string
  status: PravaMandateStatus
  merchantName: string | null
  approvedAmount: string | null
  currency: string | null
  createdAt: string
  /** Prava's derived usability: available | consumed | expired. */
  state?: string | null
}

/** One charge recorded against a mandate. `reference` is our idempotency key. */
export interface MandateCharge {
  transactionId: string
  amount: string | null
  status: string
  reference: string | null
  createdAt: string
}

export interface ChargeOutcome {
  status: 'awaiting_result' | 'failed'
  transactionId: string | null
  errorCode?: string
  errorMessage?: string
  deduplicated?: boolean
  /**
   * True when the failure is a definitive answer from Prava (a 4xx error
   * envelope: wrong merchant, mandate not active, validation). False/absent
   * means the transport failed and the charge state is genuinely unknown —
   * the distinction decides whether the commit may move on or must reconcile.
   */
  terminal?: boolean
}

export interface ReportOutcome {
  status: string // completed | failed
  mandateStatus: string
  visaConfirmation?: string | null // SUCCESS | FAILURE
  /** status === 'completed' AND the network did not report FAILURE. */
  settled: boolean
}

export interface PravaAdapter {
  readonly kind: 'mock' | 'sandbox' | 'production'

  /** Create Session with mandate_setup — returns the member's approval URL. */
  createMandateSession(input: CreateMandateSessionInput): Promise<MandateSession>

  /**
   * List mandates for one of our member ids (Prava customer_id filter).
   * Standing mandates only: an ordinary checkout creates transient per-checkout
   * mandates internally, and picking one of those up would be a live bug.
   */
  listMandates(customerId: string): Promise<MandateSummary[]>

  getMandate(mandateId: string): Promise<MandateSummary | null>

  /**
   * Charges recorded against a mandate. This is how an unknown charge state
   * gets resolved: if a charge with our idempotency reference is already on
   * the mandate, the charge happened and must never be reissued.
   */
  getMandateCharges(mandateId: string): Promise<MandateCharge[]>

  /** Charge within the mandate cap. `reference` is Prava's idempotency key. */
  chargeMandate(mandateId: string, amount: string, reference: string): Promise<ChargeOutcome>

  /** Settle the charge back through the network loop. */
  reportCharge(
    mandateId: string,
    transactionId: string,
    txnStatus: 'APPROVED' | 'DECLINED',
    amountPaid?: string,
  ): Promise<ReportOutcome>

  cancelMandate(mandateId: string): Promise<void>

  /** hold-my-share: active → paused; a paused mandate counts as not approved. */
  pauseMandate(mandateId: string): Promise<void>

  resumeMandate(mandateId: string): Promise<void>

  revokeSession(sessionId: string): Promise<void>
}
