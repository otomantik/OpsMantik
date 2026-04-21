import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * Mirrors `enforce_marketing_signals_state_machine` (Phase 5 — deterministic transition matrix).
 * In-memory guard for workers that cannot hit Postgres in CI.
 */
const ALLOWED: Record<string, Set<string>> = {
  PENDING: new Set(['PROCESSING', 'JUNK_ABORTED', 'SKIPPED_NO_CLICK_ID', 'STALLED_FOR_HUMAN_AUDIT']),
  PROCESSING: new Set(['SENT', 'FAILED', 'DEAD_LETTER_QUARANTINE', 'JUNK_ABORTED', 'PENDING']),
  STALLED_FOR_HUMAN_AUDIT: new Set(['PENDING']),
  FAILED: new Set(['PENDING']),
};

function assertLegalTransition(from: string, to: string): void {
  const next = ALLOWED[from];
  assert.ok(next?.has(to), `illegal marketing signal transition: ${from} -> ${to}`);
}

test('chaos/marketing-signal-dispatch-matrix: export + ack + maintenance paths stay within FSM', () => {
  assertLegalTransition('PENDING', 'PROCESSING');
  assertLegalTransition('PENDING', 'JUNK_ABORTED');
  assertLegalTransition('PROCESSING', 'SENT');
  assertLegalTransition('PROCESSING', 'FAILED');
  assertLegalTransition('PROCESSING', 'PENDING');
  assertLegalTransition('PROCESSING', 'DEAD_LETTER_QUARANTINE');
});

test('chaos/marketing-signal-dispatch-matrix: illegal transitions are rejected', () => {
  assert.throws(() => assertLegalTransition('PENDING', 'SENT'));
  assert.throws(() => assertLegalTransition('SENT', 'PENDING'));
});
