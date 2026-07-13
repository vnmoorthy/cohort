import { optimizePortfolio } from '@/lib/optimize';
import { insforge, hydra } from '@/lib/sponsors';
import { crew } from '@/lib/identity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Re-optimize when the target or cost/day changes.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const nctId: string = (body.nctId || '').toString().toUpperCase();
    const analysis = insforge.loadAnalysis(nctId);
    if (!analysis) return Response.json({ error: 'Trial not analyzed yet. Run analysis first.' }, { status: 404 });

    const target = Math.max(1, Math.round(Number(body.target) || analysis.optimize.optimized.forecast.target));
    const costPerDay = Number(body.costPerDay) || analysis.optimize.costPerDay;
    const siteBudget = body.siteBudget ? Number(body.siteBudget) : undefined;

    const optimize = optimizePortfolio(analysis.scoredSites, { target, costPerDay, siteBudget });
    analysis.optimize = optimize;
    insforge.persistAnalysis(analysis);

    hydra.record(
      nctId,
      crew().optimizer,
      'portfolio.reoptimized',
      'portfolio',
      nctId,
      `Re-optimized for target ${target} @ $${costPerDay.toLocaleString()}/day → ${optimize.optimized.sitesUsed} sites, $${optimize.dollarsSaved.toLocaleString()} saved.`,
    );

    return Response.json({ optimize });
  } catch (e: any) {
    return Response.json({ error: e?.message || 'Optimize failed.' }, { status: 400 });
  }
}
