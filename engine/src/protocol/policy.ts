import type { Policy } from '../types.js'

export type Decision = 'approved' | 'declined' | 'pending'

export interface Participant {
  id: string
  name: string
  decision: Decision
  weight: number
}

export type PolicyStatus = 'satisfied' | 'unsatisfiable' | 'open'

export interface PolicyResult {
  status: PolicyStatus
  /** member ids locked into the commit when satisfied */
  locked: string[]
  /** human-readable reason for the decision narrative */
  reason: string
}

function byRef(members: Participant[], ref: string): Participant | undefined {
  return members.find((m) => m.id === ref || m.name === ref)
}

/**
 * Evaluate a GMP/1 commit policy over a snapshot of participant states.
 *
 * Monotonicity invariant (property-tested): flipping any participant from
 * pending to approved never turns a satisfied policy unsatisfied, and never
 * turns satisfied into open.
 */
export function evaluatePolicy(policy: Policy, members: Participant[], now: Date): PolicyResult {
  const approvers = members.filter((m) => m.decision === 'approved')
  const pending = members.filter((m) => m.decision === 'pending')

  switch (policy.type) {
    case 'all_of': {
      const declined = members.filter((m) => m.decision === 'declined')
      if (declined.length > 0) {
        return { status: 'unsatisfiable', locked: [], reason: `all_of requires everyone; ${declined.length} declined` }
      }
      if (pending.length === 0) {
        return { status: 'satisfied', locked: approvers.map((m) => m.id), reason: `all ${approvers.length} approved` }
      }
      return { status: 'open', locked: [], reason: `${approvers.length}/${members.length} approved` }
    }

    case 'quorum': {
      if (approvers.length >= policy.m) {
        return { status: 'satisfied', locked: approvers.map((m) => m.id), reason: `quorum ${policy.m} met with ${approvers.length} approvals` }
      }
      if (approvers.length + pending.length < policy.m) {
        return { status: 'unsatisfiable', locked: [], reason: `quorum ${policy.m} unreachable (${approvers.length} approved, ${pending.length} pending)` }
      }
      return { status: 'open', locked: [], reason: `${approvers.length}/${policy.m} toward quorum` }
    }

    case 'weighted': {
      const approvedW = approvers.reduce((s, m) => s + m.weight, 0)
      const pendingW = pending.reduce((s, m) => s + m.weight, 0)
      if (approvedW >= policy.threshold) {
        return { status: 'satisfied', locked: approvers.map((m) => m.id), reason: `weight ${approvedW} ≥ ${policy.threshold}` }
      }
      if (approvedW + pendingW < policy.threshold) {
        return { status: 'unsatisfiable', locked: [], reason: `weight ${approvedW}+${pendingW} pending < ${policy.threshold}` }
      }
      return { status: 'open', locked: [], reason: `weight ${approvedW}/${policy.threshold}` }
    }

    case 'veto': {
      const vetoer = byRef(members, policy.member)
      if (vetoer && vetoer.decision === 'declined') {
        return { status: 'unsatisfiable', locked: [], reason: `${vetoer.name} vetoed` }
      }
      return evaluatePolicy(policy.inner, members, now)
    }

    case 'required': {
      const req = byRef(members, policy.member)
      if (!req) return evaluatePolicy(policy.inner, members, now)
      if (req.decision === 'declined') {
        return { status: 'unsatisfiable', locked: [], reason: `required member ${req.name} declined` }
      }
      const inner = evaluatePolicy(policy.inner, members, now)
      if (inner.status === 'unsatisfiable') return inner
      if (req.decision === 'pending') {
        return { status: 'open', locked: [], reason: `waiting on required member ${req.name}` }
      }
      if (inner.status === 'satisfied') {
        const locked = inner.locked.includes(req.id) ? inner.locked : [...inner.locked, req.id]
        return { status: 'satisfied', locked, reason: `${inner.reason}, required ${req.name} approved` }
      }
      return inner
    }

    case 'deadline': {
      const at = new Date(policy.at)
      if (now < at) {
        const primary = evaluatePolicy(policy.primary, members, now)
        if (primary.status === 'satisfied') return primary
        // Primary can no longer pass, but the fallback takes over at the
        // deadline — only give up if the fallback is also dead.
        const fallback = evaluatePolicy(policy.fallback, members, now)
        if (primary.status === 'unsatisfiable' && fallback.status === 'unsatisfiable') {
          return { status: 'unsatisfiable', locked: [], reason: `primary and fallback both unsatisfiable` }
        }
        return { status: 'open', locked: [], reason: `${primary.reason} (fallback at ${at.toISOString()})` }
      }
      const fb = evaluatePolicy(policy.fallback, members, now)
      return { ...fb, reason: `deadline passed: ${fb.reason}` }
    }
  }
}

/** Names referenced by veto/required nodes, for validation at group creation. */
export function referencedMembers(policy: Policy): string[] {
  switch (policy.type) {
    case 'veto':
    case 'required':
      return [policy.member, ...referencedMembers(policy.inner)]
    case 'deadline':
      return [...referencedMembers(policy.primary), ...referencedMembers(policy.fallback)]
    default:
      return []
  }
}
