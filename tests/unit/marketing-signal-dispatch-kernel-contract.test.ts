import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

test('migration 20261223020000 defines canonical marketing signal dispatch RPCs (service_role only)', () => {
  const migration = readFileSync(
    join(ROOT, 'supabase', 'migrations', '20261223020000_apply_marketing_signal_dispatch_batch_v1.sql'),
    'utf8'
  );
  assert.ok(migration.includes('CREATE OR REPLACE FUNCTION public.apply_marketing_signal_dispatch_batch_v1'));
  assert.ok(migration.includes('CREATE OR REPLACE FUNCTION public.rescue_marketing_signals_stale_processing_v1'));
  assert.ok(migration.includes("auth.role() IS DISTINCT FROM 'service_role'"));
  assert.ok(migration.includes('REVOKE ALL ON FUNCTION public.apply_marketing_signal_dispatch_batch_v1'));
  assert.ok(migration.includes('FROM anon, authenticated'));
  assert.ok(migration.includes('GRANT EXECUTE ON FUNCTION public.apply_marketing_signal_dispatch_batch_v1'));
  assert.ok(migration.includes('GRANT EXECUTE ON FUNCTION public.rescue_marketing_signals_stale_processing_v1'));
});

test('kernel module is queue-only retirement shim (no legacy dispatch RPC mutation)', () => {
  const kernel = readFileSync(join(ROOT, 'lib', 'oci', 'marketing-signal-dispatch-kernel.ts'), 'utf8');
  assert.ok(kernel.includes('Queue-only retirement shim'));
  assert.ok(kernel.includes('return 0;'));
  assert.ok(!kernel.includes("rpc('apply_marketing_signal_dispatch_batch_v1'"));
  assert.ok(!kernel.includes("rpc('rescue_marketing_signals_stale_processing_v1'"));
});

test('primary OCI writers do not mutate marketing_signals in queue-only mode', () => {
  const mark = readFileSync(
    join(ROOT, 'app', 'api', 'oci', 'google-ads-export', 'export-mark-processing.ts'),
    'utf8'
  );
  const ack = readFileSync(join(ROOT, 'app', 'api', 'oci', 'ack', 'route.ts'), 'utf8');
  const ackFailed = readFileSync(join(ROOT, 'app', 'api', 'oci', 'ack-failed', 'route.ts'), 'utf8');
  const maint = readFileSync(join(ROOT, 'lib', 'oci', 'maintenance', 'run-maintenance.ts'), 'utf8');
  const ackHelpers = readFileSync(join(ROOT, 'lib', 'oci', 'oci-ack-route-helpers.ts'), 'utf8');
  assert.ok(ackHelpers.includes('safeOciErrorString'), 'ack helper file exists and remains active');

  for (const [name, src] of [
    ['ack/route', ack],
    ['ack-failed/route', ackFailed],
  ] as const) {
    assert.ok(
      !src.includes(".from('marketing_signals')"),
      `${name} must not mutate marketing_signals in queue-only mode`
    );
  }

  assert.ok(
    !mark.includes('applyMarketingSignalDispatchBatch'),
    'export-mark-processing must not dispatch marketing_signals in journal-only export mode'
  );

  assert.ok(
    !mark.includes(".from('marketing_signals')"),
    'export-mark-processing must not touch marketing_signals via table client'
  );

  assert.ok(
    !maint.includes(".from('marketing_signals')"),
    'maintenance must not use direct marketing_signals client updates in queue-only mode'
  );
});

test('sweep cleanup invalidate pulse vacuum keep marketing_signals retired/no direct updates', () => {
  const paths = [
    ['invalidate-pending-artifacts', join(ROOT, 'lib', 'oci', 'invalidate-pending-artifacts.ts')],
    ['cron/cleanup', join(ROOT, 'app', 'api', 'cron', 'cleanup', 'route.ts')],
    ['cron/sweep-zombies', join(ROOT, 'app', 'api', 'cron', 'oci', 'sweep-zombies', 'route.ts')],
    ['pulse-recovery-worker', join(ROOT, 'lib', 'oci', 'pulse-recovery-worker.ts')],
    ['vacuum-worker', join(ROOT, 'lib', 'oci', 'vacuum-worker.ts')],
  ] as const;

  for (const [name, p] of paths) {
    const src = readFileSync(p, 'utf8');
    assert.ok(
      !src.includes(".from('marketing_signals')"),
      `${name} must not directly mutate marketing_signals`
    );
  }
});
