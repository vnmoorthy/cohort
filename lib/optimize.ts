// Site-portfolio optimization.
//
// Both plans open the SAME number of sites (the sponsor's site budget) — the
// win comes from WHICH sites, not how many. This mirrors the real problem:
// ~1 in 4 activated sites under-enrolls or never enrolls a single patient, so
// choosing high-rate, geographically-spread sites over a naive selection
// compresses the timeline for the same investment.
//
// Baseline = a naive selection (a representative, performance-blind slice of the
// registered sites — the way sponsors open sites they already have relationships
// with). Optimized = the best sites by regionally-discounted enrollment rate,
// de-clustered so sites in the same metro don't cannibalize one patient pool.
// Both timelines come from the full Monte-Carlo forecast.

import type { ScoredSite, OptimizeResult, Forecast } from './types';
import { runForecast } from './forecast';

const DAYS_PER_MONTH = 30.4375;

function regionalDiscount(regionCount: Map<string, number>, region: string): number {
  const rc = regionCount.get(region) || 0;
  return 1 / (1 + 0.5 * rc);
}

function selectBaseline(sites: ScoredSite[], count: number): ScoredSite[] {
  const n = sites.length;
  const c = Math.min(count, n);
  if (c <= 0) return [];
  // Evenly strided sample across the registry order — deterministic, and blind
  // to performance (that's the point: it's the un-optimized plan).
  const stride = n / c;
  const out: ScoredSite[] = [];
  for (let i = 0; i < c; i++) out.push(sites[Math.floor(i * stride)]);
  return out;
}

// Fill exactly `budget` sites, each step taking the site with the best
// regionally-discounted marginal rate (so we spread across metros instead of
// stacking a single high-prevalence city).
function selectTopPortfolio(sites: ScoredSite[], budget: number): ScoredSite[] {
  const pool = [...sites].sort((a, b) => b.score - a.score);
  const chosen = new Set<ScoredSite>();
  const selected: ScoredSite[] = [];
  const regionCount = new Map<string, number>();
  const target = Math.min(budget, pool.length);

  while (selected.length < target) {
    let best: ScoredSite | null = null;
    let bestVal = -Infinity;
    for (const s of pool) {
      if (chosen.has(s)) continue;
      const val = s.rate * regionalDiscount(regionCount, s.region) + s.score / 400;
      if (val > bestVal) {
        bestVal = val;
        best = s;
      }
    }
    if (!best) break;
    selected.push(best);
    chosen.add(best);
    regionCount.set(best.region, (regionCount.get(best.region) || 0) + 1);
  }
  return selected;
}

export interface OptimizeInput {
  target: number;
  costPerDay: number;
  siteBudget?: number;
}

export function optimizePortfolio(sites: ScoredSite[], input: OptimizeInput): OptimizeResult {
  const target = Math.max(1, Math.round(input.target));
  const costPerDay = input.costPerDay > 0 ? input.costPerDay : 55000;
  const n = sites.length;

  // The site budget both plans spend. Sized so it can reach the target, but
  // always capped below the available count so WHICH sites you pick matters
  // (if the budget equalled every registered site, both plans would be identical).
  const siteBudget =
    input.siteBudget ?? Math.min(Math.max(10, Math.ceil(target / 6)), Math.max(6, Math.floor(n * 0.85)));

  const baselineSites = selectBaseline(sites, siteBudget);
  const optimizedSites = selectTopPortfolio(sites, siteBudget);

  const baselineForecast: Forecast = runForecast(baselineSites, target, {
    seed: `baseline:${target}:${siteBudget}`,
  });
  const optimizedForecast: Forecast = runForecast(optimizedSites, target, {
    seed: `optimized:${target}:${siteBudget}`,
  });

  const baseMonths = baselineForecast.expectedMonths ?? baselineForecast.horizonMonths;
  const optMonths = optimizedForecast.expectedMonths ?? optimizedForecast.horizonMonths;
  const monthsSaved = Math.max(0, baseMonths - optMonths);
  const daysSaved = Math.round(monthsSaved * DAYS_PER_MONTH);
  const dollarsSaved = daysSaved * costPerDay;
  const sitesReduced = baselineSites.length - optimizedSites.length;

  const optRegions = new Set(optimizedSites.map((s) => s.region)).size;
  const baseRegions = new Set(baselineSites.map((s) => s.region)).size;
  const avgOptRate = optimizedSites.reduce((a, s) => a + s.rate, 0) / Math.max(1, optimizedSites.length);
  const avgBaseRate = baselineSites.reduce((a, s) => a + s.rate, 0) / Math.max(1, baselineSites.length);
  const topSite = optimizedSites[0];
  const rationale: string[] = [
    `Same ${siteBudget}-site budget, better roster: optimized sites average ${avgOptRate.toFixed(2)} patients/mo vs ${avgBaseRate.toFixed(2)} for the naive plan.`,
    topSite
      ? `Top site: ${topSite.facility} — modeled ${topSite.rate.toFixed(2)} patients/mo (${topSite.tier.replace(/-/g, ' ')}).`
      : 'No sites available.',
    `Spread across ${optRegions} regions (vs ${baseRegions}) to avoid sites cannibalizing one metro's patient pool.`,
    optimizedForecast.expectedMonths !== null
      ? `Reaches ${target} enrolled in ~${optMonths.toFixed(1)} months (p10 ${optimizedForecast.p10Months?.toFixed(1)} – p90 ${optimizedForecast.p90Months?.toFixed(1)}), vs ~${baseMonths.toFixed(1)} months naive.`
      : `Target not reachable within horizon with current constraints.`,
  ];

  return {
    baseline: {
      siteIds: baselineSites.map((s) => s.id),
      sitesUsed: baselineSites.length,
      forecast: baselineForecast,
    },
    optimized: {
      siteIds: optimizedSites.map((s) => s.id),
      sitesUsed: optimizedSites.length,
      forecast: optimizedForecast,
    },
    monthsSaved,
    daysSaved,
    dollarsSaved,
    sitesReduced,
    costPerDay,
    rationale,
  };
}
