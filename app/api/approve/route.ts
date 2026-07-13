import { band, hydra, insforge } from '@/lib/sponsors';
import { crew } from '@/lib/identity';
import { getApproval } from '@/lib/store';
import { analyzeTrial } from '@/lib/analyze';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Human study manager signs off (or rejects) the finalized site plan.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    let approvalId: string = (body.approvalId || '').toString();
    const nctId: string = (body.nctId || '').toString().toUpperCase();
    const decision: 'approved' | 'rejected' = body.decision === 'rejected' ? 'rejected' : 'approved';
    const note: string | undefined = body.note ? String(body.note) : undefined;

    let existing = getApproval(approvalId);
    // Cold serverless instance: recreate the pending approval for this trial, then sign it.
    if (!existing && nctId) {
      const a = await analyzeTrial(nctId);
      approvalId = a.approval?.id || approvalId;
      existing = getApproval(approvalId);
    }
    if (!existing) return Response.json({ error: 'Approval request not found.' }, { status: 404 });

    const resolved = band.resolveApproval(approvalId, decision, note);
    if (!resolved) return Response.json({ error: 'Could not resolve approval.' }, { status: 400 });

    const manager = crew().manager;
    hydra.record(
      resolved.nctId,
      manager,
      decision === 'approved' ? 'plan.approved' : 'plan.rejected',
      'approval',
      resolved.id,
      decision === 'approved'
        ? `Study manager APPROVED the optimized site plan${note ? ` — "${note}"` : '.'}`
        : `Study manager REJECTED the plan${note ? ` — "${note}"` : '.'}`,
    );

    // reflect status on the stored analysis
    const analysis = insforge.loadAnalysis(resolved.nctId);
    if (analysis) {
      analysis.approval = resolved;
      insforge.persistAnalysis(analysis);
    }

    const integrity = hydra.integrity(resolved.nctId);
    return Response.json({ approval: resolved, integrity });
  } catch (e: any) {
    return Response.json({ error: e?.message || 'Approval failed.' }, { status: 400 });
  }
}
