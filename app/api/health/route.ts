import { sponsorStatuses } from '@/lib/sponsors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({ ok: true, service: 'cohort', sponsors: sponsorStatuses() });
}
