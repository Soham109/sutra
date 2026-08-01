'use client'

import type { Policy } from '@/lib/api'
import { PolicyChip } from '@/components/ui'
import { Disclosure, Row, Section, ToggleChip } from './fields'
import {
  type DraftMember,
  type SimplePolicyKind,
  claimers,
  fromLocalInput,
  inMinutes,
  toLocalInput,
} from './model'

// The six forms, with the two that people actually want one click away. The
// formula is always visible: a rule you cannot read is not a rule you agreed to.

function simpleOf(p: Policy): SimplePolicyKind {
  if (p.type === 'quorum' || p.type === 'weighted') return p.type
  return 'all_of'
}

function makeSimple(kind: SimplePolicyKind, payers: number, weightTotal: number): Policy {
  if (kind === 'quorum') return { type: 'quorum', m: Math.max(1, Math.ceil(payers / 2)) }
  if (kind === 'weighted') return { type: 'weighted', threshold: Math.max(1, Math.ceil(weightTotal / 2)) }
  return { type: 'all_of' }
}

/** The inner rule of veto / required / deadline. Kept to the three flat forms so
 *  the editor cannot build a rule nobody can read back. */
function InnerPolicy({
  value,
  onChange,
  payers,
  weightTotal,
  label,
}: {
  value: Policy
  onChange: (p: Policy) => void
  payers: number
  weightTotal: number
  label: string
}) {
  const kind = simpleOf(value)
  return (
    <div className="col" style={{ gap: 8 }}>
      <span className="field-label">{label}</span>
      <Row gap={6}>
        <ToggleChip on={kind === 'all_of'} onClick={() => onChange({ type: 'all_of' })}>
          Everyone
        </ToggleChip>
        <ToggleChip on={kind === 'quorum'} onClick={() => onChange(makeSimple('quorum', payers, weightTotal))}>
          Any m
        </ToggleChip>
        <ToggleChip on={kind === 'weighted'} onClick={() => onChange(makeSimple('weighted', payers, weightTotal))}>
          By weight
        </ToggleChip>
      </Row>
      {value.type === 'quorum' && (
        <NumberRow
          label="approvals needed"
          value={value.m}
          min={1}
          max={Math.max(1, payers)}
          onChange={(m) => onChange({ type: 'quorum', m })}
        />
      )}
      {value.type === 'weighted' && (
        <NumberRow
          label={`weight needed (out of ${weightTotal})`}
          value={value.threshold}
          min={1}
          max={Math.max(1, weightTotal)}
          onChange={(threshold) => onChange({ type: 'weighted', threshold })}
        />
      )}
    </div>
  )
}

function NumberRow({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (n: number) => void
}) {
  return (
    <label className="row wrap" style={{ gap: 8 }}>
      <input
        className="input mono"
        type="number"
        min={min}
        max={max}
        value={value}
        style={{ width: 84 }}
        onChange={(e) => onChange(Math.min(max, Math.max(min, Number(e.target.value) || min)))}
      />
      <span className="small muted">{label}</span>
    </label>
  )
}

export function PolicyEditor({
  policy,
  onPolicy,
  members,
  onMembers,
}: {
  policy: Policy
  onPolicy: (p: Policy) => void
  members: DraftMember[]
  onMembers: (next: DraftMember[]) => void
}) {
  const payers = claimers(members)
  const named = members.filter((m) => m.name.trim().length > 0)
  const weightTotal = payers.reduce((a, m) => a + Math.max(0, m.weight), 0)
  const advanced = policy.type === 'veto' || policy.type === 'required' || policy.type === 'deadline'
  const kind = simpleOf(policy)

  const inner: Policy =
    policy.type === 'veto' || policy.type === 'required'
      ? policy.inner
      : policy.type === 'deadline'
        ? policy.primary
        : policy

  const setInner = (p: Policy) => {
    if (policy.type === 'veto') onPolicy({ type: 'veto', member: policy.member, inner: p })
    else if (policy.type === 'required') onPolicy({ type: 'required', member: policy.member, inner: p })
    else if (policy.type === 'deadline') onPolicy({ ...policy, primary: p })
    else onPolicy(p)
  }

  return (
    <Section
      step={4}
      title="The policy"
      lede="The rule that decides whether the group commits. It is evaluated by the engine, not by a person, and it is printed on every approval page so nobody agrees to a rule they cannot see."
      aside={<PolicyChip policy={policy} />}
    >
      {!advanced && (
        <div className="col" style={{ gap: 10 }}>
          <Row gap={6}>
            <ToggleChip on={kind === 'all_of'} onClick={() => onPolicy({ type: 'all_of' })}>
              Everyone approves
            </ToggleChip>
            <ToggleChip on={kind === 'quorum'} onClick={() => onPolicy(makeSimple('quorum', payers.length, weightTotal))}>
              Any {Math.max(1, Math.ceil(payers.length / 2))} approve
            </ToggleChip>
          </Row>
          {policy.type === 'quorum' && (
            <NumberRow
              label={`of ${payers.length} approvals commit the group`}
              value={policy.m}
              min={1}
              max={Math.max(1, payers.length)}
              onChange={(m) => onPolicy({ type: 'quorum', m })}
            />
          )}
          <p className="tiny faint">
            {policy.type === 'all_of'
              ? 'The safest rule: one decline and nobody is charged at all.'
              : 'People who never approve are not charged. The ones who do approve carry the cart between them.'}
          </p>
        </div>
      )}

      <div style={{ marginTop: advanced ? 0 : 14 }}>
        <Disclosure
          summary={advanced ? 'Advanced rule' : 'Something more specific'}
          hint="weights, a veto, one required person, or a rule that changes at a deadline"
          defaultOpen={advanced}
        >
          <div className="col" style={{ gap: 14 }}>
            <Row gap={6}>
              <ToggleChip
                on={policy.type === 'weighted'}
                onClick={() => onPolicy(makeSimple('weighted', payers.length, weightTotal))}
              >
                Weighted
              </ToggleChip>
              <ToggleChip
                on={policy.type === 'veto'}
                onClick={() =>
                  onPolicy({ type: 'veto', member: named[0]?.name ?? '', inner: { type: 'all_of' } })
                }
              >
                Veto
              </ToggleChip>
              <ToggleChip
                on={policy.type === 'required'}
                onClick={() =>
                  onPolicy({
                    type: 'required',
                    member: named[0]?.name ?? '',
                    inner: makeSimple('quorum', payers.length, weightTotal),
                  })
                }
              >
                Required person
              </ToggleChip>
              <ToggleChip
                on={policy.type === 'deadline'}
                onClick={() =>
                  onPolicy({
                    type: 'deadline',
                    at: inMinutes(30),
                    primary: { type: 'all_of' },
                    fallback: makeSimple('quorum', payers.length, weightTotal),
                  })
                }
              >
                Changes at a time
              </ToggleChip>
              {advanced && (
                <ToggleChip on={false} onClick={() => onPolicy({ type: 'all_of' })}>
                  ← back to simple
                </ToggleChip>
              )}
            </Row>

            {policy.type === 'weighted' && (
              <div className="well col" style={{ gap: 10 }}>
                <p className="small muted">
                  Approvals are counted by weight, not by head. Useful when one person is carrying most of the
                  cart and should be able to decide.
                </p>
                <NumberRow
                  label={`weight needed, out of ${weightTotal}`}
                  value={policy.threshold}
                  min={1}
                  max={Math.max(1, weightTotal)}
                  onChange={(threshold) => onPolicy({ type: 'weighted', threshold })}
                />
                <div className="col" style={{ gap: 6 }}>
                  <span className="field-label">Weights</span>
                  {payers.map((m) => (
                    <label key={m.key} className="row" style={{ gap: 8 }}>
                      <input
                        className="input mono"
                        type="number"
                        min={0}
                        max={999}
                        value={m.weight}
                        style={{ width: 74 }}
                        onChange={(e) =>
                          onMembers(
                            members.map((x) =>
                              x.key === m.key ? { ...x, weight: Math.max(0, Number(e.target.value) || 0) } : x,
                            ),
                          )
                        }
                      />
                      <span className="small">{m.name || 'Unnamed'}</span>
                    </label>
                  ))}
                </div>
                {policy.threshold > weightTotal && (
                  <p className="tiny" style={{ color: 'var(--warn)' }}>
                    No combination of approvals can reach {policy.threshold}. Lower the threshold or raise
                    somebody’s weight.
                  </p>
                )}
              </div>
            )}

            {(policy.type === 'veto' || policy.type === 'required') && (
              <div className="well col" style={{ gap: 12 }}>
                <p className="small muted">
                  {policy.type === 'veto'
                    ? 'One person can stop the group on their own, whatever everyone else decides.'
                    : 'The group cannot commit unless this specific person is one of the approvals.'}
                </p>
                <label className="row wrap" style={{ gap: 8 }}>
                  <span className="small muted">{policy.type === 'veto' ? 'Who can veto' : 'Who is required'}</span>
                  <select
                    className="select"
                    style={{ width: 'auto', minWidth: 160 }}
                    value={policy.member}
                    onChange={(e) =>
                      onPolicy(
                        policy.type === 'veto'
                          ? { type: 'veto', member: e.target.value, inner: policy.inner }
                          : { type: 'required', member: e.target.value, inner: policy.inner },
                      )
                    }
                  >
                    <option value="">Choose someone…</option>
                    {named.map((m) => (
                      <option key={m.key} value={m.name}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
                <InnerPolicy
                  label="And the rest of the group"
                  value={inner}
                  onChange={setInner}
                  payers={payers.length}
                  weightTotal={weightTotal}
                />
              </div>
            )}

            {policy.type === 'deadline' && (
              <div className="well col" style={{ gap: 12 }}>
                <p className="small muted">
                  One rule until a moment you choose, a looser one after it. This is the policy’s own switch-over
                  time — it is not the group deadline, which is set below.
                </p>
                <label className="row wrap" style={{ gap: 8 }}>
                  <span className="small muted">Switches at</span>
                  <input
                    className="input mono"
                    type="datetime-local"
                    style={{ width: 'auto' }}
                    value={toLocalInput(policy.at)}
                    onChange={(e) => {
                      const iso = fromLocalInput(e.target.value)
                      if (iso) onPolicy({ ...policy, at: iso })
                    }}
                  />
                </label>
                <InnerPolicy
                  label="Before that time"
                  value={policy.primary}
                  onChange={(p) => onPolicy({ ...policy, primary: p })}
                  payers={payers.length}
                  weightTotal={weightTotal}
                />
                <InnerPolicy
                  label="After that time"
                  value={policy.fallback}
                  onChange={(p) => onPolicy({ ...policy, fallback: p })}
                  payers={payers.length}
                  weightTotal={weightTotal}
                />
                {new Date(policy.at).getTime() <= Date.now() && (
                  <p className="tiny" style={{ color: 'var(--warn)' }}>
                    That moment has already passed, so the fallback rule would apply immediately.
                  </p>
                )}
              </div>
            )}
          </div>
        </Disclosure>
      </div>
    </Section>
  )
}
