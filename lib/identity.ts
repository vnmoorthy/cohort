// Identity layer — the ".agent / DMV" hook.
//
// Every actor that touches a regulated trial decision, human or agent, gets a
// verifiable identity. In a real deployment these are issued and verified by the
// .agent registry (DMV). Here we mint them deterministically so audit records
// are stable and replayable. The audit trail (store.ts) binds every event to
// one of these identities — which is exactly what 21 CFR Part 11 attribution
// requires, and exactly the trust layer the host community is building.

import { createHash } from 'node:crypto';
import type { Identity } from './types';

function did(handle: string): string {
  const h = createHash('sha256').update(handle).digest('hex').slice(0, 24);
  return `did:agent:${h}`;
}

export function makeIdentity(
  handle: string,
  role: string,
  kind: 'agent' | 'human',
  issuer = 'dmv.agent',
): Identity {
  return { handle, did: did(handle), kind, role, verified: true, issuer };
}

// The standard crew that runs a Cohort analysis.
export function crew(): Record<string, Identity> {
  return {
    scout: makeIdentity('site-scout@cohort.agent', 'Ingestion & web-intelligence agent', 'agent'),
    forecaster: makeIdentity('forecast-agent@cohort.agent', 'Monte-Carlo enrollment forecaster', 'agent'),
    optimizer: makeIdentity('optimizer-agent@cohort.agent', 'Site-portfolio optimizer', 'agent'),
    manager: makeIdentity('study-manager@sponsor.agent', 'Human study manager (approver)', 'human'),
  };
}

export function allIdentities(): Identity[] {
  return Object.values(crew());
}
