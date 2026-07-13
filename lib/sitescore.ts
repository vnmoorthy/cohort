// Site enrollment-rate model.
//
// For each real site we estimate the expected number of patients it will enroll
// per month. The model is an interpretable prior built from observable features
// (site type, country infrastructure, indication difficulty, competitive
// density) plus a deterministic site-specific factor that stands in for the
// unobserved historical track record. In production, Hydra DB supplies real
// versioned per-site performance and replaces that prior — the interface is the
// same, only the numbers get sharper.

import type { RawSite, ScoredSite, SiteTier, RationaleItem, TrialProtocol } from './types';
import { hashToSeed, mulberry32 } from './rng';

// Effective patients/site/month (already net of screen failure). Calibrated to
// real oncology phase-3 accrual: top academic centers ~0.7-0.9/mo, community
// sites ~0.1-0.3/mo, so a large trial needs many sites each enrolling a few.
const TIER_BASE_RATE: Record<SiteTier, number> = {
  'comprehensive-cancer-center': 1.4,
  'academic-medical-center': 1.0,
  'specialty-institute': 0.75,
  'community-hospital': 0.5,
  'community-clinic': 0.32,
};

// Local eligible-patient ceiling a site can draw before saturating.
const TIER_POOL: Record<SiteTier, number> = {
  'comprehensive-cancer-center': 55,
  'academic-medical-center': 40,
  'specialty-institute': 30,
  'community-hospital': 20,
  'community-clinic': 13,
};

const TIER_ACTIVATION: Record<SiteTier, number> = {
  'comprehensive-cancer-center': 1.5,
  'academic-medical-center': 2.0,
  'specialty-institute': 2.4,
  'community-hospital': 3.0,
  'community-clinic': 3.4,
};

// Probability a site is a "cold" under-enroller, by tier. Community sites go
// cold far more often than established cancer centers.
const TIER_COLD_PROB: Record<SiteTier, number> = {
  'comprehensive-cancer-center': 0.05,
  'academic-medical-center': 0.08,
  'specialty-institute': 0.12,
  'community-hospital': 0.2,
  'community-clinic': 0.26,
};

const TIER_LABEL: Record<SiteTier, string> = {
  'comprehensive-cancer-center': 'Comprehensive cancer center',
  'academic-medical-center': 'Academic medical center',
  'specialty-institute': 'Specialty research institute',
  'community-hospital': 'Community hospital',
  'community-clinic': 'Community clinic',
};

export function classifyTier(facility: string): SiteTier {
  const f = facility.toLowerCase();
  if (/comprehensive\s+cancer|nci-designated|memorial sloan|md anderson|dana-farber/.test(f))
    return 'comprehensive-cancer-center';
  if (/cancer center|cancer institute|oncolog/.test(f) && /universit|school of medicine|academic/.test(f))
    return 'comprehensive-cancer-center';
  if (/universit|school of medicine|health system|medical center|academic/.test(f))
    return 'academic-medical-center';
  if (/institute|cancer center|research|oncolog/.test(f)) return 'specialty-institute';
  if (/hospital|medical group|clinic|health/.test(f)) return 'community-hospital';
  return 'community-clinic';
}

// Country infrastructure factor: activation reliability + regulatory speed.
function countryFactor(country?: string): { mult: number; addActivation: number; label: string } {
  const c = (country || '').toLowerCase();
  if (['united states', 'canada'].includes(c)) return { mult: 1.0, addActivation: 0, label: 'N. America infra' };
  if (
    ['united kingdom', 'germany', 'france', 'spain', 'italy', 'netherlands', 'belgium', 'switzerland', 'australia'].includes(c)
  )
    return { mult: 0.95, addActivation: 0.5, label: 'W. Europe / AUS infra' };
  if (['japan', 'south korea', 'korea, republic of', 'taiwan', 'singapore'].includes(c))
    return { mult: 0.92, addActivation: 0.8, label: 'Developed APAC infra' };
  if (['china', 'india', 'brazil', 'russia', 'poland', 'turkey', 'mexico', 'argentina'].includes(c))
    return { mult: 1.08, addActivation: 1.2, label: 'High-volume emerging site' };
  return { mult: 0.9, addActivation: 1.0, label: 'Other region' };
}

// Indication difficulty from the condition + phase. Rarer/earlier = slower.
function indicationFactor(protocol: TrialProtocol): { mult: number; label: string } {
  const cond = (protocol.conditions.join(' ') || '').toLowerCase();
  const phase = (protocol.phase || '').toLowerCase();
  let mult = 1.0;
  const notes: string[] = [];
  if (/rare|orphan|refractory|relapsed|metastatic|advanced/.test(cond)) {
    mult *= 0.82;
    notes.push('hard-to-find population');
  }
  if (/lung|breast|colorectal|prostate|melanoma|lymphoma|diabetes|obesity|hypertension/.test(cond)) {
    mult *= 1.12;
    notes.push('prevalent indication');
  }
  if (phase.includes('1')) mult *= 0.8;
  else if (phase.includes('2')) mult *= 0.92;
  else if (phase.includes('3')) mult *= 1.0;
  else if (phase.includes('4')) mult *= 1.05;
  return { mult, label: notes.join(', ') || 'standard indication' };
}

export function regionKey(site: RawSite): string {
  const c = (site.country || 'Unknown').trim();
  if (c.toLowerCase() === 'united states') return `US-${(site.state || site.city || '??').trim()}`;
  return `${c}-${(site.city || '').trim()}`;
}

export interface ScoreContext {
  competingCount: number; // recruiting competing trials for this condition
}

export function scoreSites(protocol: TrialProtocol, ctx: ScoreContext): ScoredSite[] {
  const indication = indicationFactor(protocol);
  // Global competition drag: more competing trials => patients split across them.
  const compDrag = 1 / (1 + Math.log1p(ctx.competingCount) * 0.08);

  return protocol.sites.map((site, i) => {
    const tier = classifyTier(site.facility);
    const cf = countryFactor(site.country);
    const rng = mulberry32(hashToSeed(`${protocol.nctId}:${site.facility}:${site.city}:${i}`));
    // Site-specific track-record factor. Wide distribution with a genuine cold
    // tail: ~1 in 6 activated sites badly under-enrolls (a well-documented
    // reality — a large share of trial sites enroll near zero patients). Naive
    // plans keep these dead sites; optimization routes around them.
    const cold = rng() < TIER_COLD_PROB[tier];
    const track = cold ? 0.05 + rng() * 0.28 : 0.55 + rng() * 1.05;

    const baseRate = TIER_BASE_RATE[tier];
    let rate = baseRate * cf.mult * indication.mult * compDrag * track;
    rate = Math.max(0.05, rate);

    const rateSd = rate * 0.35;
    const activationMonths = TIER_ACTIVATION[tier] + cf.addActivation + rng() * 0.8;
    const poolSize = Math.round(TIER_POOL[tier] * (0.7 + rng() * 0.7) * indication.mult);

    const rationale: RationaleItem[] = [
      { factor: 'Site type', effect: baseRate / 0.5 - 1, detail: `${TIER_LABEL[tier]} — base ${baseRate.toFixed(2)}/mo` },
      { factor: 'Track record', effect: track - 1, detail: `${cold ? 'Under-enroller (cold site)' : 'Modeled historical performance'} ${track.toFixed(2)}×` },
      { factor: 'Region', effect: cf.mult - 1, detail: cf.label },
      { factor: 'Indication', effect: indication.mult - 1, detail: indication.label },
      { factor: 'Competition', effect: compDrag - 1, detail: `${ctx.competingCount} competing trials recruiting` },
    ];

    // Composite score 0-100: rate dominates, activation speed & pool depth adjust.
    const rateComponent = Math.min(1, rate / 1.1); // ~1.1/mo is a strong site
    const speedComponent = Math.max(0, 1 - (activationMonths - 1.5) / 4);
    const depthComponent = Math.min(1, poolSize / 50);
    const score = Math.round((rateComponent * 0.68 + speedComponent * 0.17 + depthComponent * 0.15) * 100);

    return {
      id: `${protocol.nctId}-S${String(i + 1).padStart(3, '0')}`,
      facility: site.facility,
      city: site.city,
      state: site.state,
      country: site.country,
      region: regionKey(site),
      lat: site.lat,
      lon: site.lon,
      tier,
      rate,
      rateSd,
      activationMonths,
      poolSize,
      score,
      rationale,
    };
  });
}
