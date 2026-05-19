import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

test('marketing-signal-dispatch-kernel module removed', () => {
  assert.ok(!existsSync(join(ROOT, 'lib', 'oci', 'marketing-signal-dispatch-kernel.ts')));
});

test('migration 20261223020000 defines canonical marketing signal dispatch RPCs (service_role only)', () => {
  const migration = readFileSync(
    join(ROOT, 'supabase', 'migrations', '20261223020000_apply_marketing_signal_dispatch_batch_v1.sql'),
    'utf8'
  );
  assert.ok(migration.includes('CREATE OR REPLACE FUNCTION public.apply_marketing_signal_dispatch_batch_v1'));
  assert.ok(migration.includes('CREATE OR REPLACE FUNCTION public.rescue_marketing_signals_stale_processing_v1'));
});

test('primary OCI writers do not mutate marketing_signals in queue-only mode', () => {
  const mark = readFileSync(
    join(ROOT, 'app', 'api', 'oci', 'google-ads-export', 'export-mark-processing.ts'),
    'utf8'
  );
  const ack = readFileSync(join(ROOT, 'app', 'api', 'oci', 'ack', 'route.ts'), 'utf8');
  const ackFailed = readFileSync(join(ROOT, 'app', 'api', 'oci', 'ack-failed', 'route.ts'), 'utf8');
  const maint = readFileSync(join(ROOT, 'lib', 'oci', 'maintenance', 'run-maintenance.ts'), 'utf8');

  for (const [name, src] of [
    ['ack/route', ack],
    ['ack-failed/route', ackFailed],
  ] as const) {
    assert.ok(
      !src.includes(".from('marketing_signals')"),
      `${name} must not mutate marketing_signals in queue-only mode`
    );
  }

  assert.ok(!mark.includes('applyMarketingSignalDispatchBatch'));
  assert.ok(!mark.includes(".from('marketing_signals')"));
  assert.ok(!maint.includes(".from('marketing_signals')"));
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
    assert.ok(!src.includes(".from('marketing_signals')"), `${name} must not directly mutate marketing_signals`);
  }

  const sweep = readFileSync(join(ROOT, 'app', 'api', 'cron', 'oci', 'sweep-zombies', 'route.ts'), 'utf8');
  assert.ok(!sweep.includes('marketing-signal-dispatch-kernel'));
});
