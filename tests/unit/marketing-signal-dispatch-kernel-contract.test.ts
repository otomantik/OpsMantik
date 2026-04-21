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
  assert.ok(migration.includes('GRANT EXECUTE ON FUNCTION public.apply_marketing_signal_dispatch_batch_v1'));
  assert.ok(migration.includes('GRANT EXECUTE ON FUNCTION public.rescue_marketing_signals_stale_processing_v1'));
});

test('kernel module wraps apply_marketing_signal_dispatch_batch_v1 RPC', () => {
  const kernel = readFileSync(join(ROOT, 'lib', 'oci', 'marketing-signal-dispatch-kernel.ts'), 'utf8');
  assert.ok(kernel.includes("rpc('apply_marketing_signal_dispatch_batch_v1'"));
  assert.ok(kernel.includes("rpc('rescue_marketing_signals_stale_processing_v1'"));
});

test('primary OCI writers route marketing_signals dispatch transitions through kernel', () => {
  const mark = readFileSync(
    join(ROOT, 'app', 'api', 'oci', 'google-ads-export', 'export-mark-processing.ts'),
    'utf8'
  );
  const ack = readFileSync(join(ROOT, 'app', 'api', 'oci', 'ack', 'route.ts'), 'utf8');
  const ackFailed = readFileSync(join(ROOT, 'app', 'api', 'oci', 'ack-failed', 'route.ts'), 'utf8');
  const maint = readFileSync(join(ROOT, 'lib', 'oci', 'maintenance', 'run-maintenance.ts'), 'utf8');

  for (const [name, src] of [
    ['export-mark-processing', mark],
    ['ack/route', ack],
    ['ack-failed/route', ackFailed],
  ] as const) {
    assert.ok(
      src.includes('applyMarketingSignalDispatchBatch'),
      `${name} must use applyMarketingSignalDispatchBatch`
    );
    assert.ok(
      !/\bupdate\s*\(\s*\{\s*dispatch_status\s*:/i.test(src),
      `${name} must not use PostgREST dispatch_status object updates`
    );
  }

  assert.ok(
    !mark.includes(".from('marketing_signals')"),
    'export-mark-processing must not touch marketing_signals via table client'
  );

  assert.ok(
    maint.includes('rescueStaleMarketingSignalsProcessing'),
    'maintenance must rescue stale PROCESSING signals via kernel'
  );
  assert.ok(
    !maint.includes(".from('marketing_signals')"),
    'maintenance must not use direct marketing_signals client updates for zombie rescue'
  );
});
