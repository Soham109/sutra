// Real Prava REST client. Contracts verified against
// https://docs.prava.space/api-reference/openapi.json on 2026-08-01.
import type {
  ChargeOutcome,
  CreateMandateSessionInput,
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
  ) {
    super(`Prava ${status} ${code}: ${message}`)
  }
}

export class PravaClient implements PravaAdapter {
  readonly kind: 'sandbox' | 'production'

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {
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
    const text = await res.text()
    let json: unknown
    try {
      json = text ? JSON.parse(text) : {}
    } catch {
      throw new PravaHttpError(res.status, 'BAD_JSON', text.slice(0, 200))
    }
    if (!res.ok) {
      const err = (json as { error?: { code?: string; message?: string } }).error
      throw new PravaHttpError(res.status, err?.code ?? 'UNKNOWN', err?.message ?? text.slice(0, 200))
    }
    return json as T
  }

  async createMandateSession(input: CreateMandateSessionInput): Promise<MandateSession> {
    const res = await this.request<{
      session_id: string
      iframe_url: string
      expires_at: string
    }>('POST', '/v1/sessions', {
      user_id: input.userId,
      user_email: input.userEmail,
      total_amount: input.totalAmount,
      currency: input.currency,
      description: input.description,
      callback_url: input.callbackUrl,
      integration_type: 'full_checkout',
      purchase_context: [
        {
          merchant_details: input.merchant,
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
    return { sessionId: res.session_id, approvalUrl: res.iframe_url, expiresAt: res.expires_at }
  }

  async listMandates(customerId: string): Promise<MandateSummary[]> {
    const res = await this.request<{ mandates: RawMandate[] }>(
      'GET',
      `/v1/mandates?customer_id=${encodeURIComponent(customerId)}`,
    )
    return (res.mandates ?? []).map(toSummary)
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

  async chargeMandate(mandateId: string, amount: string, reference: string): Promise<ChargeOutcome> {
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
      errorMessage: res.errorMessage,
      deduplicated: res.deduplicated,
    }
  }

  async reportCharge(
    mandateId: string,
    transactionId: string,
    txnStatus: 'APPROVED' | 'DECLINED',
    amountPaid?: string,
  ): Promise<ReportOutcome> {
    const res = await this.request<{ status: string; mandateStatus: string }>(
      'POST',
      `/v1/mandates/${mandateId}/charges/${transactionId}/report`,
      { txn_status: txnStatus, txn_type: 'PURCHASE', amount_paid: amountPaid },
    )
    return { status: res.status, mandateStatus: res.mandateStatus }
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
}

function toSummary(m: RawMandate): MandateSummary {
  return {
    id: m.id,
    status: m.status,
    merchantName: m.merchantName ?? null,
    approvedAmount: m.approvedAmount ?? null,
    currency: m.currency ?? null,
    createdAt: m.createdAt ?? '',
  }
}
