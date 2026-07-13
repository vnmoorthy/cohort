// Orchestration — runs the Cohort crew end to end for a trial.
//
// site-scout (ingest + landscape + prevalence) -> forecast-agent (score sites)
// -> optimizer-agent (portfolio + forecast) -> BAND approval request to the human
// study manager. Every step is written to the Hydra-style audit ledger under a
// verified .agent identity, then the whole analysis is persisted via InsForge.

import { fetchTrial } from './ctgov';
import { scoreSites } from './sitescore';
import { optimizePortfolio } from './optimize';
import { crew, allIdentities } from './identity';
import { sponsorStatuses, youcom, nimble, hydra, band, insforge } from './sponsors';
import { resetAudit } from './store';
import type { TrialAnalysis, Landscape } from './types';

export interface AnalyzeOptions {
  target?: number;
  costPerDay?: number;
}

export async function analyzeTrial(nctId: string, opts: AnalyzeOptions = {}): Promise<TrialAnalysis> {
  const actors = crew();

  // 1. Ingest the real trial. Start a fresh audit session for this analysis.
  const protocol = await fetchTrial(nctId);
  resetAudit(protocol.nctId);
  hydra.record(
    protocol.nctId,
    actors.scout,
    'trial.ingested',
    'trial',
    protocol.nctId,
    `Ingested "${protocol.title}" — ${protocol.sites.length} registered sites, target ${protocol.targetEnrollment ?? 'n/a'}.`,
    { sponsor: protocol.sponsor, phase: protocol.phase, conditions: protocol.conditions },
  );

  // 2. Map the competitive landscape (Nimble -> CTgov) + prevalence (You.com).
  const condition = protocol.conditions[0] || '';
  const [{ trials, source: landscapeSource }, prevalence] = await Promise.all([
    nimble.competingTrials(condition, protocol.nctId),
    youcom.estimatePatientPool(protocol),
  ]);

  const landscape: Landscape = {
    condition: condition || 'Unspecified',
    competingTrials: trials.slice(0, 40),
    competingCount: trials.length,
    patientPoolEstimate: prevalence.patientPoolEstimate,
    source: landscapeSource === 'nimble' ? 'nimble' : prevalence.source === 'youcom' ? 'youcom' : 'ctgov-fallback',
    notes: prevalence.notes,
  };
  hydra.record(
    protocol.nctId,
    actors.scout,
    'landscape.mapped',
    'landscape',
    protocol.nctId,
    `${trials.length} competing trials recruiting for ${condition || 'this indication'}; eligible pool ≈ ${prevalence.patientPoolEstimate.toLocaleString()}.`,
  );

  // 3. Score every site.
  const scoredSites = scoreSites(protocol, { competingCount: trials.length });
  hydra.record(
    protocol.nctId,
    actors.forecaster,
    'sites.scored',
    'sites',
    protocol.nctId,
    `Modeled enrollment rate for ${scoredSites.length} sites (mean ${(
      scoredSites.reduce((a, s) => a + s.rate, 0) / Math.max(1, scoredSites.length)
    ).toFixed(2)} patients/site/mo).`,
  );

  // 4. Optimize the portfolio + forecast both plans.
  const target = Math.max(1, Math.round(opts.target ?? protocol.targetEnrollment ?? 300));
  const costPerDay = opts.costPerDay ?? 55000;
  const optimize = optimizePortfolio(scoredSites, { target, costPerDay });
  hydra.record(
    protocol.nctId,
    actors.optimizer,
    'portfolio.optimized',
    'portfolio',
    protocol.nctId,
    `Optimized to ${optimize.optimized.sitesUsed} sites: ${optimize.monthsSaved.toFixed(1)} months / $${optimize.dollarsSaved.toLocaleString()} saved vs a ${optimize.baseline.sitesUsed}-site baseline.`,
    { monthsSaved: optimize.monthsSaved, dollarsSaved: optimize.dollarsSaved },
  );

  // 5. Request human sign-off through BAND.
  const approval = band.requestApproval(
    protocol.nctId,
    'Finalize optimized site plan',
    `Approve activating ${optimize.optimized.sitesUsed} sites to enroll ${target} patients in ~${optimize.optimized.forecast.expectedMonths?.toFixed(1) ?? '—'} months.`,
    actors.optimizer,
    actors.manager,
  );
  hydra.record(
    protocol.nctId,
    actors.optimizer,
    'approval.requested',
    'approval',
    approval.id,
    `Requested human sign-off from ${actors.manager.handle} via ${approval.channel === 'band' ? 'BAND' : 'BAND (local fallback)'}.`,
  );

  const analysis: TrialAnalysis = {
    protocol,
    scoredSites,
    landscape,
    identities: allIdentities(),
    optimize,
    sponsors: sponsorStatuses(),
    approval,
  };
  insforge.persistAnalysis(analysis);
  return analysis;
}
