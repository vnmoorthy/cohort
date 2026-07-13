// InsForge adapter — agent-native backend (persistence).
//
// LIVE (INSFORGE_API_KEY set): persists the trial analysis + scenario state to
// an InsForge project (Postgres/KV) so it survives restarts and is queryable.
// FALLBACK: the in-process store in store.ts.

import type { TrialAnalysis } from '../types';
import { saveAnalysis, getAnalysis } from '../store';

export function persistAnalysis(a: TrialAnalysis): void {
  saveAnalysis(a);
  const key = process.env.INSFORGE_API_KEY;
  const url = process.env.INSFORGE_PROJECT_URL;
  if (key && url) {
    fetch(`${url.replace(/\/$/, '')}/kv/cohort_analysis/${a.protocol.nctId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(a),
    }).catch(() => {});
  }
}

export function loadAnalysis(nctId: string): TrialAnalysis | undefined {
  return getAnalysis(nctId);
}

export function isLive(): boolean {
  return !!(process.env.INSFORGE_API_KEY && process.env.INSFORGE_PROJECT_URL);
}
