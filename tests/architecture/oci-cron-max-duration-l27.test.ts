/**
 * L27 — Every OCI / queue cron route must declare an explicit `maxDuration`.
 *
 * Without it, Vercel applies platform defaults and timed-out runs may not
 * release their cron lock cleanly (see `CRON_LOCK_TTL_SEC` in each route).
 * The test only checks for presence; per-route values are tuned in source.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

const OCI_CRON_ROUTES = [
  'app/api/cron/oci-maintenance/route.ts',
  'app/api/cron/oci-recovery/route.ts',
  'app/api/cron/oci/process-outbox-events/route.ts',
  'app/api/cron/oci/sweep-zombies/route.ts',
  'app/api/cron/sweep-unsent-conversions/route.ts',
  'app/api/cron/oci/outbox-cleanup/route.ts',
  'app/api/cron/oci/ack-receipt-ttl/route.ts',
  'app/api/cron/oci/backfill-precursor-signals/route.ts',
  'app/api/cron/oci/enqueue-from-sales/route.ts',
  'app/api/cron/oci/promote-blocked-queue/route.ts',
  'app/api/cron/oci/attempt-cap/route.ts',
  'app/api/cron/oci/recover-stuck-signals/route.ts',
  'app/api/cron/process-offline-conversions/route.ts',
];

const MAX_DURATION_RE = /^\s*export\s+const\s+maxDuration\s*=\s*(\d+)\s*;?\s*$/m;

for (const rel of OCI_CRON_ROUTES) {
  test(`L27 maxDuration declared: ${rel}`, () => {
    const src = readFileSync(join(ROOT, rel), 'utf8');
    const match = src.match(MAX_DURATION_RE);
    assert.ok(match, `${rel}: export const maxDuration = <seconds> is required`);
    const seconds = Number(match![1]);
    assert.ok(
      Number.isFinite(seconds) && seconds > 0 && seconds <= 300,
      `${rel}: maxDuration must be a positive integer ≤ 300, got ${seconds}`
    );
  });
}
