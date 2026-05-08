/**
 * PR-OCI-5 (P1): stale PENDING marketing_signals must be terminalized
 * to avoid infinite resend attempts and silent backlog growth.
 * Source-inspection tests (fast, stable, DB-free).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CLEANUP_ROUTE = join(process.cwd(), 'app', 'api', 'cron', 'cleanup', 'route.ts');

test('PR-OCI-5: cleanup cron keeps marketing_signals retired (queue-only mode)', () => {
  const src = readFileSync(CLEANUP_ROUTE, 'utf-8');

  assert.ok(src.includes('queue_only_mode'));
  assert.ok(src.includes("legacy_marketing_signals_cleanup: 'retired'"));
  assert.ok(!src.includes(".from('marketing_signals')"));
  assert.ok(!src.includes('STALLED_FOR_HUMAN_AUDIT'));
  assert.ok(!src.includes('applyMarketingSignalDispatchBatch'));
});
