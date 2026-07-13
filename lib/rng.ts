// Deterministic, seedable RNG + sampling helpers for the Monte-Carlo engine.
// Determinism matters: the same scenario must forecast the same number every
// time so a live demo is reproducible and an audit can be replayed.

import { createHash } from 'node:crypto';

export function hashToSeed(s: string): number {
  const h = createHash('sha256').update(s).digest();
  // Take 4 bytes -> unsigned 32-bit seed.
  return h.readUInt32BE(0) || 1;
}

// mulberry32 PRNG — fast, good enough for Monte-Carlo, fully deterministic.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Standard normal via Box-Muller.
export function randNormal(rng: () => number, mean = 0, sd = 1): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return mean + sd * z;
}

// Gamma(shape k, scale theta) via Marsaglia-Tsang. Used to draw a per-site
// enrollment rate from its prior, capturing site-to-site heterogeneity.
export function randGamma(rng: () => number, k: number, theta: number): number {
  if (k < 1) {
    const c = randGamma(rng, k + 1, theta);
    return c * Math.pow(rng(), 1 / k);
  }
  const d = k - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x = 0;
    let vv = 0;
    do {
      x = randNormal(rng);
      vv = 1 + c * x;
    } while (vv <= 0);
    vv = vv * vv * vv;
    const u = rng();
    if (u < 1 - 0.0331 * x * x * x * x) return d * vv * theta;
    if (Math.log(u) < 0.5 * x * x + d * (1 - vv + Math.log(vv))) return d * vv * theta;
  }
}

// Poisson sampler (Knuth for small lambda, normal approx for large).
export function randPoisson(rng: () => number, lambda: number): number {
  if (lambda <= 0) return 0;
  if (lambda > 30) {
    return Math.max(0, Math.round(randNormal(rng, lambda, Math.sqrt(lambda))));
  }
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > L);
  return k - 1;
}

export function quantile(sortedAsc: number[], q: number): number {
  if (sortedAsc.length === 0) return 0;
  const pos = (sortedAsc.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sortedAsc[base + 1] !== undefined) {
    return sortedAsc[base] + rest * (sortedAsc[base + 1] - sortedAsc[base]);
  }
  return sortedAsc[base];
}
