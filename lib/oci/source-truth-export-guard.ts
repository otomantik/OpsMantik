import type { TrafficClassificationV2 } from '@/lib/attribution/truth-engine-types';

export type SourceTruthExportBlockReason =
  | 'SOURCE_TRUTH_FRAUD'
  | 'SOURCE_TRUTH_NOT_PAID'
  | 'SOURCE_TRUTH_ORGANIC_SHOPPING';

export function validateSourceTruthForExport(
  ledger: TrafficClassificationV2 | null | undefined
): { ok: true } | { ok: false; reason: SourceTruthExportBlockReason } {
  if (!ledger || ledger.classifier_version !== 'source_truth_v2') {
    return { ok: true };
  }

  if (ledger.is_fraud_suspected || ledger.channel === 'fraudulent_signal') {
    return { ok: false, reason: 'SOURCE_TRUTH_FRAUD' };
  }

  if (ledger.channel === 'organic_shopping') {
    return { ok: false, reason: 'SOURCE_TRUTH_ORGANIC_SHOPPING' };
  }

  if (ledger.is_paid === false && ledger.identity_grade === 'click_id_strong') {
    return { ok: false, reason: 'SOURCE_TRUTH_NOT_PAID' };
  }

  return { ok: true };
}
