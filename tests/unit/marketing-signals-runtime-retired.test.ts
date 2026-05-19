/**
 * Runtime must not write marketing_signals; retention runs via night-maintenance RPC only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

const RETIRED_PATHS = [
  'lib/domain/mizan-mantik/insert-marketing-signal.ts',
  'lib/domain/mizan-mantik/upsert-marketing-signal.ts',
  'lib/oci/upsert-marketing-signal.ts',
  'lib/oci/marketing-signal-queue-parity.ts',
  'lib/oci/marketing-signal-dispatch-kernel.ts',
  'app/api/cron/marketing-signals-cleanup/route.ts',
] as const;

for (const rel of RETIRED_PATHS) {
  test(`retired: ${rel} removed from repo`, () => {
    assert.ok(!existsSync(join(ROOT, rel)), `${rel} must be deleted`);
  });
}

test('night-maintenance retains marketing_signals retention RPC (DB hygiene only)', () => {
  const src = readFileSync(join(ROOT, 'app', 'api', 'cron', 'night-maintenance', 'route.ts'), 'utf8');
  assert.ok(src.includes('cleanup_marketing_signals_batch'), 'night job must run retention RPC');
  assert.ok(!src.includes('.insert('), 'night job must not insert marketing_signals rows');
});

test('vercel.json does not schedule marketing-signals-cleanup', () => {
  const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8')) as {
    crons: { path: string }[];
  };
  const paths = vercel.crons.map((c) => c.path);
  assert.ok(!paths.includes('/api/cron/marketing-signals-cleanup'));
});
