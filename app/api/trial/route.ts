import { analyzeTrial } from '@/lib/analyze';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const nctId: string = (body.nctId || '').toString();
    if (!nctId) return Response.json({ error: 'Missing nctId.' }, { status: 400 });

    const target = body.target ? Number(body.target) : undefined;
    const costPerDay = body.costPerDay ? Number(body.costPerDay) : undefined;
    const analysis = await analyzeTrial(nctId, { target, costPerDay });
    return Response.json({ analysis });
  } catch (e: any) {
    return Response.json({ error: e?.message || 'Failed to analyze trial.' }, { status: 400 });
  }
}
