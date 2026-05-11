/**
 * PR-9I.1: ACK SUCCESS finalizes a claimed export dispatch. Export-time eligibility
 * (sendability, gates, single-conversion policy) is authoritative at claim; ACK must
 * not hard-block on mutable post-claim call state.
 */

export type AckScriptResultKind = 'SUCCESS' | 'FAILED';

/** Deterministic classification for seal_* queue rows on ACK SUCCESS (no live call fetch). */
export type AckFinalizationCode =
  | 'ACK_FINALIZE_SUCCESS'
  | 'ACK_REPLAY_ALREADY_COMPLETED'
  | 'ACK_REPLAY_ALREADY_UPLOADED'
  | 'ACK_IGNORE_ALREADY_FAILED'
  | 'ACK_REJECT_NOT_PROCESSING';

const TERMINAL_SUCCESS = new Set(['COMPLETED', 'UPLOADED', 'COMPLETED_UNVERIFIED']);
const TERMINAL_FAILURE_LIKE = new Set(['FAILED', 'DEAD_LETTER_QUARANTINE']);

export function classifyAckFinalization(
  row: { status: string },
  ackResult: AckScriptResultKind
): AckFinalizationCode {
  if (ackResult !== 'SUCCESS') {
    return 'ACK_REJECT_NOT_PROCESSING';
  }
  const s = (row.status ?? '').trim();
  if (s === 'PROCESSING') return 'ACK_FINALIZE_SUCCESS';
  if (s === 'UPLOADED') return 'ACK_REPLAY_ALREADY_UPLOADED';
  if (s === 'COMPLETED' || s === 'COMPLETED_UNVERIFIED') return 'ACK_REPLAY_ALREADY_COMPLETED';
  if (TERMINAL_FAILURE_LIKE.has(s)) return 'ACK_IGNORE_ALREADY_FAILED';
  return 'ACK_REJECT_NOT_PROCESSING';
}

export type AckSealSuccessAggregation = {
  /** Rows eligible for append_script_transition_batch → COMPLETED / UPLOADED */
  finalizeIds: string[];
  /** Counts keyed by {@link AckFinalizationCode} */
  tally: Partial<Record<AckFinalizationCode, number>>;
};

/**
 * Partition DB rows for a script ACK SUCCESS on seal ids. Does not consult `calls` or sendability.
 */
export function aggregateAckSealSuccessRows(rows: Array<{ id: string; status: string }>): AckSealSuccessAggregation {
  const tally: Partial<Record<AckFinalizationCode, number>> = {};
  const finalizeIds: string[] = [];
  for (const row of rows) {
    const code = classifyAckFinalization(row, 'SUCCESS');
    tally[code] = (tally[code] ?? 0) + 1;
    if (code === 'ACK_FINALIZE_SUCCESS') finalizeIds.push(row.id);
  }
  return { finalizeIds, tally };
}

/** Safe observability labels (counts only; use in logs / JSON meta). */
export const ACK_SUCCESS_POLICY_CODES = {
  FINALIZED_CLAIMED_ROW: 'ACK_SUCCESS_FINALIZED_CLAIMED_ROW',
  REPLAY_ALREADY_TERMINAL: 'ACK_SUCCESS_REPLAY_ALREADY_TERMINAL',
  NOT_BLOCKED_BY_POST_CLAIM_SENDABILITY: 'ACK_SUCCESS_NOT_BLOCKED_BY_POST_CLAIM_SENDABILITY',
} as const;

export function mapAckFinalizationTallyToObservability(tally: Partial<Record<AckFinalizationCode, number>>): {
  ACK_SUCCESS_FINALIZED_CLAIMED_ROW: number;
  ACK_SUCCESS_REPLAY_ALREADY_TERMINAL: number;
  ACK_SUCCESS_IGNORE_ALREADY_FAILED: number;
  ACK_SUCCESS_REJECT_NOT_PROCESSING: number;
} {
  return {
    ACK_SUCCESS_FINALIZED_CLAIMED_ROW: tally.ACK_FINALIZE_SUCCESS ?? 0,
    ACK_SUCCESS_REPLAY_ALREADY_TERMINAL:
      (tally.ACK_REPLAY_ALREADY_COMPLETED ?? 0) + (tally.ACK_REPLAY_ALREADY_UPLOADED ?? 0),
    ACK_SUCCESS_IGNORE_ALREADY_FAILED: tally.ACK_IGNORE_ALREADY_FAILED ?? 0,
    ACK_SUCCESS_REJECT_NOT_PROCESSING: tally.ACK_REJECT_NOT_PROCESSING ?? 0,
  };
}

export function isTerminalSuccessStatus(status: string): boolean {
  return TERMINAL_SUCCESS.has((status ?? '').trim());
}
