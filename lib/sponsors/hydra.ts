// Hydra DB adapter — versioned, tamper-evident audit ledger.
//
// LIVE (HYDRA_API_KEY set): mirrors every audit event into Hydra's versioned
// knowledge graph so each decision is a first-class, addressable, time-travelable
// record. FALLBACK: the local append-only hash chain in store.ts, which already
// gives tamper-evidence and replay.

import type { AuditEvent, Identity } from '../types';
import { appendAudit, getAudit, verifyChain } from '../store';

export function record(
  nctId: string,
  actor: Identity,
  action: string,
  entityType: string,
  entityId: string,
  summary: string,
  payload?: Record<string, unknown>,
): AuditEvent {
  const event = appendAudit(nctId, actor, action, entityType, entityId, summary, payload);
  const key = process.env.HYDRA_API_KEY;
  const base = process.env.HYDRA_BASE_URL;
  if (key && base) {
    // fire-and-forget mirror to Hydra; local chain remains source of truth
    fetch(`${base.replace(/\/$/, '')}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ collection: 'cohort-audit', key: nctId, event }),
    }).catch(() => {});
  }
  return event;
}

export function history(nctId: string): AuditEvent[] {
  return getAudit(nctId);
}

export function integrity(nctId: string) {
  return verifyChain(nctId);
}

export function isLive(): boolean {
  return !!(process.env.HYDRA_API_KEY && process.env.HYDRA_BASE_URL);
}
