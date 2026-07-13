// Monte-Carlo enrollment forecast.
//
// Each simulation draws a "true" monthly rate for every selected site from its
// Gamma prior (captures site-to-site uncertainty), then walks month by month:
//   - sites contribute nothing until they are activated,
//   - ramp linearly to full rate over the first couple of active months,
//   - saturate as they exhaust their local eligible pool,
//   - sites in the same region compete for the same patients (shared pool).
// Monthly enrollment is a Poisson draw around the effective rate. We run many
// sims and read the distribution of cumulative enrollment and time-to-target.

import type { ScoredSite, Forecast, ForecastPoint } from './types';
import { hashToSeed, mulberry32, randGamma, randPoisson, quantile } from './rng';

const RAMP_MONTHS = 2.5;
const DEFAULT_SIMS = 400;

export interface ForecastOptions {
  sims?: number;
  horizonMonths?: number;
  seed?: string;
}

export function runForecast(
  sites: ScoredSite[],
  target: number,
  opts: ForecastOptions = {},
): Forecast {
  const sims = opts.sims ?? DEFAULT_SIMS;
  const horizon = opts.horizonMonths ?? 60;
  const seedStr = opts.seed ?? `${target}:${sites.map((s) => s.id).sort().join(',')}`;
  const rng = mulberry32(hashToSeed(seedStr));

  // Regional competition: sites sharing a region split a common patient pool.
  const regionCount = new Map<string, number>();
  for (const s of sites) regionCount.set(s.region, (regionCount.get(s.region) || 0) + 1);

  const n = sites.length;
  // Precompute Gamma prior params per site (shape k, scale theta).
  const shape = new Float64Array(n);
  const scale = new Float64Array(n);
  const effPool = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const s = sites[i];
    const cv = s.rateSd > 0 ? s.rateSd / s.rate : 0.35;
    const k = Math.max(1.2, 1 / (cv * cv));
    shape[i] = k;
    scale[i] = s.rate / k;
    const rc = regionCount.get(s.region) || 1;
    effPool[i] = s.poolSize / (1 + 0.5 * (rc - 1));
  }

  // cumulative[sim * horizon + month]
  const cumulative = new Float32Array(sims * horizon);
  const monthToTarget: number[] = [];

  for (let sim = 0; sim < sims; sim++) {
    const drawnRate = new Float64Array(n);
    const siteCum = new Float64Array(n);
    for (let i = 0; i < n; i++) drawnRate[i] = randGamma(rng, shape[i], scale[i]);

    let total = 0;
    let hit: number | null = null;
    let prevTotal = 0;
    for (let m = 0; m < horizon; m++) {
      const monthNo = m + 1;
      for (let i = 0; i < n; i++) {
        const s = sites[i];
        if (monthNo <= s.activationMonths) continue;
        const active = monthNo - s.activationMonths;
        const ramp = Math.min(1, active / RAMP_MONTHS);
        const saturation = Math.max(0, 1 - siteCum[i] / effPool[i]);
        const lambda = drawnRate[i] * ramp * saturation;
        if (lambda <= 0) continue;
        let e = randPoisson(rng, lambda);
        // never enroll beyond the remaining local pool
        const remaining = Math.max(0, effPool[i] - siteCum[i]);
        if (e > remaining) e = Math.floor(remaining);
        siteCum[i] += e;
        total += e;
      }
      cumulative[sim * horizon + m] = total;
      if (hit === null && total >= target) {
        // linear interpolation within the month for a smooth fractional estimate
        const denom = total - prevTotal;
        const frac = denom > 0 ? (target - prevTotal) / denom : 0;
        hit = m + Math.min(1, Math.max(0, frac));
      }
      prevTotal = total;
    }
    if (hit !== null) monthToTarget.push(hit);
  }

  // Per-month mean / p10 / p90 of cumulative enrollment.
  const curve: ForecastPoint[] = [];
  const col = new Float64Array(sims);
  for (let m = 0; m < horizon; m++) {
    let sum = 0;
    for (let sim = 0; sim < sims; sim++) {
      const v = cumulative[sim * horizon + m];
      col[sim] = v;
      sum += v;
    }
    const sorted = Array.from(col).sort((a, b) => a - b);
    curve.push({
      month: m + 1,
      mean: sum / sims,
      p10: quantile(sorted, 0.1),
      p90: quantile(sorted, 0.9),
    });
  }

  const reached = monthToTarget.slice().sort((a, b) => a - b);
  const probByTarget = monthToTarget.length / sims;
  const expectedMonths = reached.length ? quantile(reached, 0.5) : null;
  const p10Months = reached.length ? quantile(reached, 0.1) : null;
  const p90Months = reached.length ? quantile(reached, 0.9) : null;

  return {
    target,
    curve,
    expectedMonths,
    p10Months,
    p90Months,
    probByTarget,
    sitesUsed: n,
    finalEnrollmentMean: curve.length ? curve[curve.length - 1].mean : 0,
    horizonMonths: horizon,
  };
}
