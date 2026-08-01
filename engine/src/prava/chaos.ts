// Fault-injecting proxy around any PravaAdapter (GMP/1 §11). Wraps calls with
// probabilistic 500s, timeouts and duplicate deliveries so the chaos suite can
// prove the commit algorithm's invariants under fire. Never aimed at sandbox —
// the factory refuses to wrap a non-mock adapter.
import type {
  ChargeOutcome,
  CreateMandateSessionInput,
  MandateCharge,
  MandateSession,
  MandateSummary,
  PravaAdapter,
  ReportOutcome,
} from './adapter.js'

export interface FaultConfig {
  /** probability a call throws a simulated 500 before reaching Prava */
  pErrorBefore: number
  /** probability a call succeeds at Prava but the response is lost (timeout) */
  pLostResponse: number
  /** probability a successful call is silently executed twice (duplicate delivery) */
  pDuplicate: number
  /** deterministic RNG for reproducible chaos runs */
  random: () => number
}

export const NO_FAULTS: FaultConfig = {
  pErrorBefore: 0,
  pLostResponse: 0,
  pDuplicate: 0,
  random: Math.random,
}

export class ChaosError extends Error {
  constructor(readonly mode: 'error_before' | 'lost_response') {
    super(`chaos: ${mode}`)
  }
}

export class ChaosPrava implements PravaAdapter {
  readonly kind

  constructor(
    private readonly inner: PravaAdapter,
    private readonly faults: FaultConfig,
  ) {
    if (inner.kind !== 'mock') {
      throw new Error('ChaosPrava refuses to wrap a non-mock adapter — sandbox test cards are rate-limited')
    }
    this.kind = inner.kind
  }

  private async wrap<T>(call: () => Promise<T>): Promise<T> {
    const { pErrorBefore, pLostResponse, pDuplicate, random } = this.faults
    if (random() < pErrorBefore) throw new ChaosError('error_before')
    const result = await call()
    if (random() < pDuplicate) await call().catch(() => undefined)
    if (random() < pLostResponse) throw new ChaosError('lost_response')
    return result
  }

  createMandateSession(input: CreateMandateSessionInput): Promise<MandateSession> {
    return this.wrap(() => this.inner.createMandateSession(input))
  }
  listMandates(customerId: string): Promise<MandateSummary[]> {
    return this.wrap(() => this.inner.listMandates(customerId))
  }
  getMandate(mandateId: string): Promise<MandateSummary | null> {
    return this.wrap(() => this.inner.getMandate(mandateId))
  }
  /**
   * Faulted like everything else. Reconciliation is exactly the call the engine
   * makes when it is already unsure, so a chaos run must be free to break it —
   * the invariant is that a failed reconciliation leaves the state unknown,
   * never that it silently reads as "no charge landed".
   */
  getMandateCharges(mandateId: string): Promise<MandateCharge[]> {
    return this.wrap(() => this.inner.getMandateCharges(mandateId))
  }
  chargeMandate(mandateId: string, amount: string, reference: string): Promise<ChargeOutcome> {
    return this.wrap(() => this.inner.chargeMandate(mandateId, amount, reference))
  }
  reportCharge(
    mandateId: string,
    transactionId: string,
    txnStatus: 'APPROVED' | 'DECLINED',
    amountPaid?: string,
  ): Promise<ReportOutcome> {
    return this.wrap(() => this.inner.reportCharge(mandateId, transactionId, txnStatus, amountPaid))
  }
  cancelMandate(mandateId: string): Promise<void> {
    return this.wrap(() => this.inner.cancelMandate(mandateId))
  }
  pauseMandate(mandateId: string): Promise<void> {
    return this.wrap(() => this.inner.pauseMandate(mandateId))
  }
  resumeMandate(mandateId: string): Promise<void> {
    return this.wrap(() => this.inner.resumeMandate(mandateId))
  }
  revokeSession(sessionId: string): Promise<void> {
    return this.wrap(() => this.inner.revokeSession(sessionId))
  }
}
