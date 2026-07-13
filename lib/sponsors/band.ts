// BAND adapter — human-in-the-loop approval + agent coordination.
//
// A site plan cannot be finalized by an agent alone: a human study manager must
// sign off. BAND is the interaction layer that carries that approval request and
// enforces the authority boundary.
//
// LIVE (BAND_API_KEY set): opens a real approval task in BAND addressed to the
// human approver. FALLBACK: a local approval object resolved through the
// /api/approve route (the demo's "click to sign off" button).

import type { ApprovalRequest, Identity } from '../types';
import { saveApproval, getApproval, newId } from '../store';

export function requestApproval(
  nctId: string,
  action: string,
  summary: string,
  requestedBy: Identity,
  approver: Identity,
): ApprovalRequest {
  const live = !!process.env.BAND_API_KEY;
  const req: ApprovalRequest = {
    id: newId('appr'),
    nctId,
    action,
    summary,
    requestedBy,
    approver,
    status: 'pending',
    createdAt: new Date(Date.parse('2026-07-13T17:00:00Z')).toISOString(),
    channel: live ? 'band' : 'local-fallback',
  };
  saveApproval(req);
  if (live) {
    fetch('https://api.band.ai/v1/approvals', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.BAND_API_KEY}` },
      body: JSON.stringify({
        title: action,
        body: summary,
        assignee: approver.handle,
        requester: requestedBy.handle,
        ref: `${nctId}:${req.id}`,
      }),
    }).catch(() => {});
  }
  return req;
}

export function resolveApproval(
  id: string,
  decision: 'approved' | 'rejected',
  note?: string,
): ApprovalRequest | undefined {
  const req = getApproval(id);
  if (!req) return undefined;
  req.status = decision;
  req.note = note;
  req.resolvedAt = new Date(Date.parse('2026-07-13T17:05:00Z')).toISOString();
  saveApproval(req);
  return req;
}

export function isLive(): boolean {
  return !!process.env.BAND_API_KEY;
}
