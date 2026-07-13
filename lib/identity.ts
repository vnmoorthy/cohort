// Identity layer — the ".agent / DMV" hook.
//
// Every actor that touches a regulated trial decision, human or agent, gets a
// verifiable identity. In a real deployment these are issued and verified by the
// .agent registry (DMV). Here we mint them deterministically so audit records
// are stable and replayable. The audit trail (store.ts) binds every event to
// one of these identities — which is exactly what 21 CFR Part 11 attribution
// requires, and exactly the trust layer the host community is building.

import { createHash } from 'node:crypto';
import type { Identity, BandAgentRef } from './types';

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

const BAND_ROLE_LABEL: Record<string, string> = {
  scout: 'Ingestion & web-intelligence agent',
  forecaster: 'Monte-Carlo enrollment forecaster',
  optimizer: 'Site-portfolio optimizer',
  manager: 'Human study manager (approver)',
};

// Map a BAND-registered agent to a Cohort identity. When BAND is live, these
// replace the local identities — every actor is a real, BAND-issued identity.
export function fromBand(ref: BandAgentRef): Identity {
  return {
    handle: ref.handle,
    did: `did:band:${ref.id}`,
    kind: ref.role === 'manager' ? 'human' : 'agent',
    role: BAND_ROLE_LABEL[ref.role] || ref.name,
    verified: true,
    issuer: 'band.ai',
  };
}
