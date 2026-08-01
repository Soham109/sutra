// Real Prava REST client. Contracts verified field-for-field against
// https://docs.prava.space/api-reference/openapi.json — our local openapi.json
// is byte-identical to the live spec (re-verified 2026-08-01).
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

export class PravaHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** VAL_2001 names the offending fields here. */
    readonly details?: unknown,
    /** X-Response-ID — Prava support asks for this first. */
    readonly responseId?: string,
  ) {
    super(`Prava ${status} ${code}: ${message}${responseId ? ` [${responseId}]` : ''}`)
  }

  /**
   * A 4xx error envelope is Prava's definitive answer, not a transport blip.
   * Retrying it wastes the window and — worse — lets a deterministic refusal
   * masquerade as unknown charge state.
   */
  get terminal(): boolean {
    return this.status >= 400 && this.status < 500
  }
}

export class PravaClient implements PravaAdapter {
  readonly kind: 'sandbox' | 'production'

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {
    if (!apiKey.startsWith('sk_')) {
      // A publishable pk_ key silently 401s on every call; fail loudly instead.
      throw new Error('PRAVA_API_KEY must be a secret key (sk_test_* or sk_live_*)')
    }
    this.kind = apiKey.startsWith('sk_live_') ? 'production' : 'sandbox'
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const responseId = res.headers.get('x-response-id') ?? undefined
    const text = await res.text()
    let json: unknown
    try {
      json = text ? JSON.parse(text) : {}
    } catch {
      throw new PravaHttpError(res.status, 'BAD_JSON', text.slice(0, 200), undefined, responseId)
    }
    if (!res.ok) {
      const err = (json as { error?: { code?: string; message?: string; details?: unknown } }).error
      throw new PravaHttpError(
        res.status,
        err?.code ?? 'UNKNOWN',
        err?.message ?? text.slice(0, 200),
        err?.details,
        responseId,
      )
    }
    return json as T
  }

  async createMandateSession(input: CreateMandateSessionInput): Promise<MandateSession> {
    const res = await this.request<{
      session_id: string
      iframe_url: string
      expires_at: string
      order_id?: string
      authorizeOnly?: boolean
    }>('POST', '/v1/sessions', {
      user_id: input.userId,
      user_email: input.userEmail,
      total_amount: input.totalAmount,
      currency: input.currency,
      description: input.description,
      // "Must use https" — a localhost base URL 400s the whole session, so an
      // http callback is dropped rather than allowed to sink the request. The
      // poller, not the callback, is what actually detects approval.
      callback_url: httpsOnly(input.callbackUrl),
      external_order_ref: input.externalOrderRef,
      integration_type: 'full_checkout',
      purchase_context: [
        {
          merchant_details: { ...input.merchant, url: forceHttps(input.merchant.url) },
          product_details: input.products,
          effective_until_minutes: input.effectiveUntilMinutes ?? 60,
        },
      ],
      mandate_setup: {
        intent: 'mandate_setup',
        recurring_frequency: 'one_time',
        merchant_scope: 'listed',
        max_charges: 1,
      },
    })
    // The docs say `authorizeOnly` is "present and true for mandate-setup
    // sessions". The live sandbox does not send it at all — verified
    // 2026-08-01, a Create Session response carries exactly session_id,
    // session_token, expires_at, iframe_url, order_id, for a mandate_setup body
    // and a plain one alike.
    //
    // We briefly refused to proceed without it, which blocked every approval.
    // There is no substitute assertion available at creation time either: a
    // mandate does not exist until the human completes the passkey ceremony,
    // so `GET /v1/mandates?customer_id=…` is empty for both kinds of session
    // immediately after creation. The real confirmation is the one the poller
    // already performs — a standing mandate appearing `active` for this
    // customer once they have approved. Anything stricter here is a guess
    // dressed as a check.
    return {
      sessionId: res.session_id,
      approvalUrl: res.iframe_url,
      expiresAt: res.expires_at,
      orderId: res.order_id ?? null,
      authorizeOnly: res.authorizeOnly ?? null,
    }
  }

  async listMandates(customerId: string): Promise<MandateSummary[]> {
    // standing_only excludes the transient per-checkout mandates every ordinary
    // checkout creates internally — picking one of those up would read as an
    // approval that never happened.
    const res = await this.request<{ mandates: RawMandate[] }>(
      'GET',
      `/v1/mandates?customer_id=${encodeURIComponent(customerId)}&standing_only=true`,
    )
    // Newest first: the API guarantees no ordering, and a requote leaves an
    // older cancelled mandate on the same customer id.
    return (res.mandates ?? [])
      .map(toSummary)
      .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
  }

  async getMandate(mandateId: string): Promise<MandateSummary | null> {
    try {
      const res = await this.request<RawMandate>('GET', `/v1/mandates/${mandateId}`)
      return toSummary(res)
    } catch (e) {
      if (e instanceof PravaHttpError && e.status === 404) return null
      throw e
    }
  }

  async getMandateCharges(mandateId: string): Promise<MandateCharge[]> {
    try {
      const res = await this.request<RawMandate & { charges?: RawCharge[] }>(
        'GET',
        `/v1/mandates/${mandateId}`,
      )
      return (res.charges ?? []).map((c) => ({
        transactionId: c.transactionId,
        amount: c.amount ?? null,
        status: c.status,
        reference: c.reference ?? null,
        createdAt: c.createdAt ?? '',
      }))
    } catch (e) {
      if (e instanceof PravaHttpError && e.status === 404) return []
      throw e
    }
  }

  async chargeMandate(mandateId: string, amount: string, reference: string): Promise<ChargeOutcome> {
    try {
      const res = await this.request<{
        status: 'awaiting_result' | 'failed'
        transactionId?: string
        errorCode?: string
        errorMessage?: string
        deduplicated?: boolean
      }>('POST', `/v1/mandates/${mandateId}/charge`, { amount, reference })
      return {
        status: res.status,
        transactionId: res.transactionId ?? null,
        errorCode: res.errorCode,
        // An over-cap decline arrives as a 200 with the reason in errorMessage
        // (e.g. THRESHOLD_EXCEEDED) and no errorCode — keep both.
        errorMessage: res.errorMessage,
        deduplicated: res.deduplicated,
        terminal: res.status === 'failed',
      }
    } catch (e) {
      if (e instanceof PravaHttpError && e.terminal) {
        // 403 MANDATE_MERCHANT_NOT_ALLOWED, 409 MANDATE_NOT_ACTIVE, VAL_2001…
        // Definitive refusals: no charge was created, so retrying is pointless
        // and calling this "unknown" would stall the commit forever.
        return {
          status: 'failed',
          transactionId: null,
          errorCode: e.code,
          errorMessage: e.message,
          terminal: true,
        }
      }
      throw e
    }
  }

  async reportCharge(
    mandateId: string,
    transactionId: string,
    txnStatus: 'APPROVED' | 'DECLINED',
    amountPaid?: string,
  ): Promise<ReportOutcome> {
    const res = await this.request<{
      status: string
      mandateStatus: string
      visaConfirmation?: string
    }>(
      'POST',
      `/v1/mandates/${mandateId}/charges/${transactionId}/report`,
      { txn_status: txnStatus, txn_type: 'PURCHASE', amount_paid: amountPaid },
    )
    return {
      status: res.status,
      mandateStatus: res.mandateStatus,
      visaConfirmation: res.visaConfirmation ?? null,
      // A 200 can still carry status:"failed" or visaConfirmation:"FAILURE";
      // settlement is only closed when the network says so.
      settled: res.status === 'completed' && res.visaConfirmation !== 'FAILURE',
    }
  }

  async cancelMandate(mandateId: string): Promise<void> {
    try {
      await this.request('POST', `/v1/mandates/${mandateId}/cancel`)
    } catch (e) {
      // 409 MANDATE_INVALID_TRANSITION means it is already terminal — fine.
      if (e instanceof PravaHttpError && (e.status === 409 || e.status === 404)) return
      throw e
    }
  }

  async pauseMandate(mandateId: string): Promise<void> {
    try {
      await this.request('POST', `/v1/mandates/${mandateId}/pause`)
    } catch (e) {
      if (e instanceof PravaHttpError && e.status === 409) return
      throw e
    }
  }

  async resumeMandate(mandateId: string): Promise<void> {
    try {
      await this.request('POST', `/v1/mandates/${mandateId}/resume`)
    } catch (e) {
      if (e instanceof PravaHttpError && e.status === 409) return
      throw e
    }
  }

  async revokeSession(sessionId: string): Promise<void> {
    try {
      await this.request('POST', `/v1/sessions/${sessionId}/revoke`)
    } catch (e) {
      if (e instanceof PravaHttpError && e.status === 404) return
      throw e
    }
  }
}

interface RawMandate {
  id: string
  status: PravaMandateStatus
  merchantName?: string | null
  approvedAmount?: string | null
  currency?: string | null
  createdAt?: string
  /** available | consumed | expired — Prava's derived usability. */
  state?: string | null
}

interface RawCharge {
  transactionId: string
  amount?: string | null
  status: string
  reference?: string | null
  createdAt?: string
}

function toSummary(m: RawMandate): MandateSummary {
  return {
    id: m.id,
    status: m.status,
    merchantName: m.merchantName ?? null,
    approvedAmount: m.approvedAmount ?? null,
    currency: m.currency ?? null,
    createdAt: m.createdAt ?? '',
    state: m.state ?? null,
  }
}

/** Prava rejects non-https callbacks outright; a dev base URL simply has none. */
function httpsOnly(url?: string): string | undefined {
  if (!url) return undefined
  return url.startsWith('https://') ? url : undefined
}

/** merchant_details.url is forwarded to Visa and must be https. */
function forceHttps(url: string): string {
  return url.replace(/^http:\/\//i, 'https://')
}
