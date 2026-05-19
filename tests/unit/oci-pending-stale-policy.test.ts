/**
 * PR-OCI-5 (P1): cleanup cron queue-only mode (no legacy audit retention).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RETIRED_FROM_CLAUSE } from '../helpers/retired-oci-vocabulary';

const CLEANUP_ROUTE = join(process.cwd(), 'app', 'api', 'cron', 'cleanup', 'route.ts');

test('PR-OCI-5: cleanup cron is queue-only', () => {
  const src = readFileSync(CLEANUP_ROUTE, 'utf-8');
  assert.ok(src.includes('queue_only_mode'));
  assert.ok(src.includes("legacy_signals_cleanup: 'retired'"));
  assert.ok(!src.includes(RETIRED_FROM_CLAUSE));
  assert.ok(!src.includes('STALLED_FOR_HUMAN_AUDIT'));
  assert.ok(!src.includes('applyRetiredDispatchBatch'));
});
