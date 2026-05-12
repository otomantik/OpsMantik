/**
 * PR-9J.CI-AUDIT-P1 — call-level junk/reversal invalidation must not leak BLOCKED_PRECEDING_SIGNALS.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

test('invalidatePendingOciArtifactsForCall selects non-terminal statuses including BLOCKED_PRECEDING_SIGNALS', () => {
  const src = readFileSync(join(process.cwd(), 'lib', 'oci', 'invalidate-pending-artifacts.ts'), 'utf8');
  assert.ok(
    src.includes("'QUEUED', 'RETRY', 'PROCESSING', 'UPLOADED', 'BLOCKED_PRECEDING_SIGNALS'") ||
      src.includes("'BLOCKED_PRECEDING_SIGNALS'"),
    'status filter must include BLOCKED_PRECEDING_SIGNALS'
  );
  assert.ok(src.includes('CALL_NOT_SENDABLE_FOR_OCI'), 'error payload must use deterministic provider code');
  assert.ok(src.includes('DETERMINISTIC_SKIP'), 'error payload must classify as deterministic skip');
  assert.ok(src.includes('block_reason'), 'invalidation must clear block_reason via clear_fields');
  assert.ok(src.includes('blocked_at'), 'invalidation must clear blocked_at via clear_fields');
  assert.ok(
    src.includes('oci_invalidation_blocked_preceding_terminalized_total'),
    'must emit refactor metric for blocked-preceding terminalization'
  );
});
