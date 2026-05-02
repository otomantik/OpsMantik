/**
 * Pure planning for precursor signal backfill — testable “conversion math”.
 *
 * Per stage implied by `calls.status`, pick occurred_at source:
 * - ledger event time when present
 * - else if any ledger exists for this call → hybrid (status fills gap; time = confirmed/created, not job NOW)
 * - else full snapshot fallback (no ledger at all for this call)
 */

import type { OptimizationStage } from '@/lib/oci/optimization-contract';

export type BackfillTimeSource = 'ledger' | 'call_snapshot_fallback' | 'call_snapshot_hybrid';

/** Which precursor stages `calls.status` implies (export funnel contract). */
export function stagesImpliedByCallStatus(status: string | null): OptimizationStage[] {
  const s = (status ?? '').trim().toLowerCase();
  if (s === 'real' || s === 'confirmed') {
    return ['contacted', 'offered'];
  }
  if (s === 'qualified') {
    return ['contacted'];
  }
  return [];
}

export function planPrecursorBackfillStages(params: {
  ledgerContacted: string | null;
  ledgerOffered: string | null;
  callStatus: string | null;
  confirmedAt: string | null;
  createdAt: string;
}): Array<{ stage: OptimizationStage; occurredIso: string; source: BackfillTimeSource }> {
  const fallbackIso = (params.confirmedAt?.trim() || params.createdAt || '').trim();
  if (!fallbackIso) {
    return [];
  }

  const fromLedger = new Map<OptimizationStage, string>();
  if (params.ledgerContacted) fromLedger.set('contacted', params.ledgerContacted);
  if (params.ledgerOffered) fromLedger.set('offered', params.ledgerOffered);

  const neededStages = stagesImpliedByCallStatus(params.callStatus);
  if (neededStages.length === 0) {
    return [];
  }

  const hasAnyLedger = fromLedger.size > 0;
  const out: Array<{ stage: OptimizationStage; occurredIso: string; source: BackfillTimeSource }> = [];

  for (const stage of neededStages) {
    const ledgerIso = fromLedger.get(stage);
    if (ledgerIso) {
      out.push({ stage, occurredIso: ledgerIso, source: 'ledger' });
      continue;
    }
    if (hasAnyLedger) {
      out.push({ stage, occurredIso: fallbackIso, source: 'call_snapshot_hybrid' });
    } else {
      out.push({ stage, occurredIso: fallbackIso, source: 'call_snapshot_fallback' });
    }
  }

  return out;
}
