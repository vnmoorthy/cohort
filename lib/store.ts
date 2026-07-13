// Hydra-style versioned, tamper-evident ledger + in-process state.
//
// The audit trail is an append-only hash chain: each event carries the hash of
// the previous event, so any tampering breaks the chain and is detectable. This
// mirrors Hydra DB's versioned, time-aware model (every state transition is a
// first-class, addressable record). When HYDRA_API_KEY is set, the Hydra adapter
// writes here AND to Hydra; without it, this local ledger is the source of truth.
//
// State (analyses, approvals) is held in a module-level singleton so the API
// routes can reference an ingested trial across requests — this stands in for
// the InsForge backend and is swapped out by the InsForge adapter when live.

import { createHash } from 'node:crypto';
import type { AuditEvent, Identity, TrialAnalysis, ApprovalRequest } from './types';

interface GlobalState {
  analyses: Map<string, TrialAnalysis>;
  audit: Map<string, AuditEvent[]>; // nctId -> chain
  approvals: Map<string, ApprovalRequest>; // approvalId -> request
  clock: number; // deterministic monotonic timestamp counter
}

// Survive Next.js hot-reload by stashing on globalThis.
const g = globalThis as unknown as { __cohort__?: GlobalState };
if (!g.__cohort__) {
  g.__cohort__ = { analyses: new Map(), audit: new Map(), approvals: new Map(), clock: 0 };
}
const state = g.__cohort__;

// Deterministic timestamps keep the demo + audit replayable. Base date is the
// event's logical order, not wall-clock, so runs are reproducible.
function nextTs(): string {
  state.clock += 1;
  const base = Date.parse('2026-07-13T17:00:00.000Z');
  return new Date(base + state.clock * 1000).toISOString();
}

function chainHash(prevHash: string, e: Omit<AuditEvent, 'hash'>): string {
  const material = JSON.stringify({
    seq: e.seq,
    ts: e.ts,
    actor: e.actor.did,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId,
    summary: e.summary,
    payload: e.payload ?? null,
    prevHash,
  });
  return createHash('sha256').update(material).digest('hex');
}

export function appendAudit(
  nctId: string,
  actor: Identity,
  action: string,
  entityType: string,
  entityId: string,
  summary: string,
  payload?: Record<string, unknown>,
): AuditEvent {
  const chain = state.audit.get(nctId) || [];
  const prevHash = chain.length ? chain[chain.length - 1].hash : 'GENESIS';
  const partial: Omit<AuditEvent, 'hash'> = {
    seq: chain.length,
    ts: nextTs(),
    actor,
    action,
    entityType,
    entityId,
    summary,
    payload,
    prevHash,
  };
  const hash = chainHash(prevHash, partial);
  const event: AuditEvent = { ...partial, hash };
  chain.push(event);
  state.audit.set(nctId, chain);
  return event;
}

export function getAudit(nctId: string): AuditEvent[] {
  return state.audit.get(nctId) || [];
}

// Start a fresh audit session for a trial (called when a new analysis begins).
export function resetAudit(nctId: string): void {
  state.audit.delete(nctId);
}

// Verify the hash chain is intact (nothing was altered or removed).
export function verifyChain(nctId: string): { valid: boolean; brokenAt: number | null; length: number } {
  const chain = state.audit.get(nctId) || [];
  let prevHash = 'GENESIS';
  for (let i = 0; i < chain.length; i++) {
    const e = chain[i];
    const { hash, ...partial } = e;
    const recomputed = chainHash(prevHash, partial);
    if (recomputed !== hash || e.prevHash !== prevHash) {
      return { valid: false, brokenAt: i, length: chain.length };
    }
    prevHash = hash;
  }
  return { valid: true, brokenAt: null, length: chain.length };
}

export function saveAnalysis(a: TrialAnalysis): void {
  state.analyses.set(a.protocol.nctId, a);
}

export function getAnalysis(nctId: string): TrialAnalysis | undefined {
  return state.analyses.get(nctId.toUpperCase());
}

export function saveApproval(r: ApprovalRequest): void {
  state.approvals.set(r.id, r);
}

export function getApproval(id: string): ApprovalRequest | undefined {
  return state.approvals.get(id);
}

export function newId(prefix: string): string {
  state.clock += 1;
  return `${prefix}_${state.clock.toString(36)}${createHash('sha256')
    .update(`${prefix}:${state.clock}`)
    .digest('hex')
    .slice(0, 6)}`;
}
