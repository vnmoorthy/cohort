// AgentOS / AgentHog adapter — agent-run observability (https://api.theagentos.space).
//
// When AGENTOS_API_KEY (agops_...) is set, each analysis emits a trace: the crew's
// steps (ingest, landscape, forecast, optimize) become tool-call spans under one
// trace, viewable at app.theagentos.space/traces and shareable with judges.
// Uses the batch REST endpoint directly (the SDK's transport envelope 426'd; the
// REST API is stable) — every failure is swallowed so it never breaks analysis.

import { randomBytes } from 'node:crypto';
import type { TrialProtocol, Landscape, OptimizeResult, AgentHogTrace } from '../types';

const ENDPOINT = process.env.AGENTOS_ENDPOINT || 'https://api.theagentos.space';
const AGENT_ID = 'cohort-crew';

const hex = (n: number) => randomBytes(n).toString('hex');

export function isLive(): boolean {
  return !!process.env.AGENTOS_API_KEY;
}

export async function traceAnalysis(
  protocol: TrialProtocol,
  landscape: Landscape,
  optimize: OptimizeResult,
): Promise<AgentHogTrace> {
  const key = process.env.AGENTOS_API_KEY;
  if (!key) return { live: false };

  const traceId = hex(16);
  const root = hex(8);
  const now = () => new Date().toISOString();
  const opt = optimize.optimized.forecast;
  const base = optimize.baseline.forecast;

  const span = (name: string, props: Record<string, unknown>) => ({
    event_type: 'agent.tool_call',
    timestamp: now(),
    trace_id: traceId,
    span_id: hex(8),
    parent_span_id: root,
    agent_id: AGENT_ID,
    properties: { name, ...props },
  });

  const events = [
    span('site-scout.ingest', { tool: 'clinicaltrials.gov', nct: protocol.nctId, sites: protocol.sites.length, target: protocol.targetEnrollment ?? null }),
    span('site-scout.landscape', { tool: 'you.com', competing_trials: landscape.competingCount, patient_pool: landscape.patientPoolEstimate }),
    span('forecast-agent.montecarlo', { optimized_months: opt.expectedMonths, naive_months: base.expectedMonths, prob_target: opt.probByTarget }),
    span('optimizer.portfolio', { sites: optimize.optimized.sitesUsed, months_saved: optimize.monthsSaved, dollars_saved: optimize.dollarsSaved }),
  ];

  try {
    const r = await fetch(`${ENDPOINT}/v1/events/batch`, {
      method: 'POST',
      headers: { 'X-API-Key': key, 'content-type': 'application/json' },
      body: JSON.stringify({ events }),
      cache: 'no-store',
    });
    if (!r.ok) return { live: true };
    return { live: true, traceId, url: 'https://app.theagentos.space/traces', spans: events.length };
  } catch {
    return { live: true };
  }
}
