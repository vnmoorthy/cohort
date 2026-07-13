import { hydra } from '@/lib/sponsors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const nctId = (url.searchParams.get('nctId') || '').toUpperCase();
  if (!nctId) return Response.json({ error: 'Missing nctId.' }, { status: 400 });
  const events = hydra.history(nctId);
  const integrity = hydra.integrity(nctId);
  return Response.json({ events, integrity, live: hydra.isLive() });
}
