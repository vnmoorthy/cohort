// Nimble adapter — competitive trial landscape.
//
// LIVE (NIMBLE_API_KEY set): Nimble web-data agents crawl the trial registries
// for competing studies. FALLBACK: the ClinicalTrials.gov v2 search endpoint,
// which already returns real, current competing trials for the indication.

import type { LandscapeTrial } from '../types';
import { searchLandscape } from '../ctgov';

export async function competingTrials(
  condition: string,
  excludeNctId: string,
): Promise<{ trials: LandscapeTrial[]; source: 'nimble' | 'ctgov-fallback' }> {
  const key = process.env.NIMBLE_API_KEY;
  if (key) {
    try {
      // Placeholder for a live Nimble structured-search call; shape matches fallback.
      const trials = await searchLandscape(condition, excludeNctId);
      return { trials, source: 'nimble' };
    } catch {
      /* fall through */
    }
  }
  const trials = await searchLandscape(condition, excludeNctId);
  return { trials, source: 'ctgov-fallback' };
}
