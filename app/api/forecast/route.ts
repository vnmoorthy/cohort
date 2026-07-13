import { runForecast } from '@/lib/forecast';
import { insforge } from '@/lib/sponsors';
import { analyzeTrial } from '@/lib/analyze';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DAYS_PER_MONTH = 30.4375;

// What-if forecast: recompute the timeline for an arbitrary site selection and
// compare it to the stored baseline plan. Fast enough to run on every toggle.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const nctId: string = (body.nctId || '').toString().toUpperCase();
    const selectedSiteIds: string[] = Array.isArray(body.selectedSiteIds) ? body.selectedSiteIds : [];
    // Re-analyze on a cache miss (cold serverless instance) — deterministic, so
    // the site set is identical to the original analysis.
    const analysis = insforge.loadAnalysis(nctId) || (nctId ? await analyzeTrial(nctId) : undefined);
    if (!analysis) return Response.json({ error: 'Trial not analyzed yet. Run analysis first.' }, { status: 404 });

    const target = Math.max(1, Math.round(Number(body.target) || analysis.optimize.optimized.forecast.target));
    const costPerDay = Number(body.costPerDay) || analysis.optimize.costPerDay;

    const selected = analysis.scoredSites.filter((s) => selectedSiteIds.includes(s.id));
    if (selected.length === 0) return Response.json({ error: 'No sites selected.' }, { status: 400 });

    const forecast = runForecast(selected, target, {
      seed: `whatif:${target}:${[...selectedSiteIds].sort().join(',')}`,
    });

    const baseline = analysis.optimize.baseline.forecast;
    const baseMonths = baseline.expectedMonths ?? baseline.horizonMonths;
    const optMonths = forecast.expectedMonths ?? forecast.horizonMonths;
    const monthsSaved = Math.max(0, baseMonths - optMonths);
    const daysSaved = Math.round(monthsSaved * DAYS_PER_MONTH);

    return Response.json({
      forecast,
      comparison: {
        baselineMonths: baseMonths,
        months: optMonths,
        reachedTarget: forecast.expectedMonths !== null,
        monthsSaved,
        daysSaved,
        dollarsSaved: daysSaved * costPerDay,
        sitesUsed: selected.length,
        costPerDay,
      },
    });
  } catch (e: any) {
    return Response.json({ error: e?.message || 'Forecast failed.' }, { status: 400 });
  }
}
