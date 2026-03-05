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

test('PR-OCI-5: cleanup cron implements stale PENDING -> STALLED_FOR_HUMAN_AUDIT policy (default 30d)', () => {
  const src = readFileSync(CLEANUP_ROUTE, 'utf-8');

  assert.ok(
    src.includes("DEFAULT_DAYS_PENDING_STALE = 30") || /DEFAULT_DAYS_PENDING_STALE\s*=\s*30/.test(src),
    'Expected default stale-pending window to be 30 days'
  );

  assert.ok(
    src.includes("'dispatch_status', 'PENDING'") || src.includes('"dispatch_status", "PENDING"') || src.includes(".eq('dispatch_status', 'PENDING')"),
    'Expected cleanup cron to select PENDING marketing_signals'
  );

  assert.ok(
    src.includes("dispatch_status: 'STALLED_FOR_HUMAN_AUDIT'") || src.includes('dispatch_status: "STALLED_FOR_HUMAN_AUDIT"'),
    'Expected cleanup cron to update dispatch_status to STALLED_FOR_HUMAN_AUDIT for stale PENDING rows'
  );
});
