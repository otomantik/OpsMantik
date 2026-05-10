/**
 * PR-9H.6.1 — Read-only diagnostics: does an intent/stage have an expected offline_conversion_queue journal outcome?
 * Does not mutate the database unless an explicit repair tool calls enqueue separately.
 */

import type { IntentJournalClassification } from '@/lib/oci/intent-conversion-journal-contract';

export type IntentQueueParityDiagnostic =
  | 'QUEUE_ROW_PRESENT'
  | 'QUEUE_ROW_MISSING'
  | 'QUEUE_ROW_BLOCKED'
  | 'QUEUE_ROW_COMPLETED'
  | 'QUEUE_ROW_DUPLICATE_SUPPRESSED';

const TERMINAL_SUCCESS = new Set(['COMPLETED', 'COMPLETED_UNVERIFIED', 'UPLOADED']);

function normAction(v: string | null | undefined): string {
  return (v ?? '').trim();
}

/**
 * Rows should be scoped by site + provider + call_id (caller filters before passing).
 */
export function diagnoseIntentQueueJournalParity(params: {
  /** e.g. OpsMantik_Won */
  expectedConversionName: string;
  /** Queue rows matching call_id (+ optional filters) */
  rowsForCall: Array<{
    status?: string | null;
    action?: string | null;
    block_reason?: string | null;
  }>;
}): IntentQueueParityDiagnostic {
  const expected = normAction(params.expectedConversionName);
  const matches = params.rowsForCall.filter((r) => normAction(r.action) === expected);

  if (matches.length === 0) return 'QUEUE_ROW_MISSING';

  if (matches.length > 1) {
    const activelyPending = matches.filter((r) => {
      const s = (r.status ?? '').trim().toUpperCase();
      return s === 'QUEUED' || s === 'RETRY' || s === 'PROCESSING' || s === 'BLOCKED_PRECEDING_SIGNALS';
    });
    if (activelyPending.length > 1) return 'QUEUE_ROW_DUPLICATE_SUPPRESSED';
  }

  const primary = matches.sort((a, b) => {
    const ua = Date.parse(String((a as { updated_at?: string }).updated_at ?? '')) || 0;
    const ub = Date.parse(String((b as { updated_at?: string }).updated_at ?? '')) || 0;
    return ub - ua;
  })[0];

  const st = (primary.status ?? '').trim().toUpperCase();

  if (TERMINAL_SUCCESS.has(st)) return 'QUEUE_ROW_COMPLETED';

  if (st === 'FAILED' || st === 'VOIDED_BY_REVERSAL' || st === 'DEAD_LETTER_QUARANTINE') {
    return 'QUEUE_ROW_BLOCKED';
  }

  if (st === 'BLOCKED_PRECEDING_SIGNALS' || Boolean(primary.block_reason?.trim())) {
    return 'QUEUE_ROW_BLOCKED';
  }

  if (matches.length > 1) return 'QUEUE_ROW_DUPLICATE_SUPPRESSED';

  return 'QUEUE_ROW_PRESENT';
}

/** Map parity diagnostic → PR-9H.6 classification hint (for docs / tooling). */
export function parityDiagnosticToClassificationHint(d: IntentQueueParityDiagnostic): IntentJournalClassification {
  switch (d) {
    case 'QUEUE_ROW_MISSING':
      return 'INTENT_NOT_JOURNALIZED';
    case 'QUEUE_ROW_BLOCKED':
      return 'INTENT_JOURNALIZED_NOT_EXPORT_ELIGIBLE';
    case 'QUEUE_ROW_COMPLETED':
      return 'INTENT_ALREADY_COMPLETED';
    case 'QUEUE_ROW_DUPLICATE_SUPPRESSED':
      return 'INTENT_DUPLICATE_SUPPRESSED';
    default:
      return 'INTENT_JOURNALIZED_READY';
  }
}
