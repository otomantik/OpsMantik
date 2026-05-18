import type { TrafficClassificationV2 } from './truth-engine-types';

export type SourceTruthExplainSummary = {
  channel: string;
  confidence_label: string;
  confidence_score: number;
  reason_code: string;
  top_evidence: string[];
  has_contradiction: boolean;
  contradiction_summary: string | null;
};

/** Operator-facing summary from shadow ledger (panel drawer). */
export function formatSourceTruthExplain(
  ledger: TrafficClassificationV2 | null | undefined
): SourceTruthExplainSummary | null {
  if (!ledger || ledger.classifier_version !== 'source_truth_v2') return null;

  return {
    channel: ledger.channel,
    confidence_label: ledger.confidence_label,
    confidence_score: ledger.confidence_score,
    reason_code: ledger.reason_code,
    top_evidence: ledger.selected_evidence.slice(0, 5),
    has_contradiction: ledger.contradiction_reasons.length > 0,
    contradiction_summary:
      ledger.contradiction_reasons.length > 0
        ? ledger.contradiction_reasons.join(', ')
        : null,
  };
}
