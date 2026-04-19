/**
 * Phase 4 regression guard: bitemporal marketing_signals surface is dropped.
 *
 * The Phase 11 bitemporal ledger (sys_period + valid_period columns, history
 * table, trigger, get_marketing_signals_as_of RPC) was YAGNI — no consumer
 * read past states and every UPDATE paid a history-insert + range open/close
 * cost. Phase 4 drops it entirely in migration
 * 20260419170000_drop_bitemporal_marketing_signals.sql. This test pins the
 * drop so it cannot silently regress.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const DROP_MIGRATION = join(
  ROOT,
  'supabase',
  'migrations',
  '20260419170000_drop_bitemporal_marketing_signals.sql'
);

test('Phase 4 drop migration removes bitemporal surface', () => {
  const src = readFileSync(DROP_MIGRATION, 'utf8');

  assert.ok(
    src.includes('DROP TRIGGER IF EXISTS trg_marketing_signals_bitemporal'),
    'must drop the bitemporal BEFORE UPDATE trigger'
  );
  assert.ok(
    src.includes('DROP FUNCTION IF EXISTS public.marketing_signals_bitemporal_audit()'),
    'must drop the bitemporal audit trigger function'
  );
  assert.ok(
    src.includes('DROP FUNCTION IF EXISTS public.get_marketing_signals_as_of(uuid, timestamptz)'),
    'must drop the time-travel RPC'
  );
  assert.ok(
    src.includes('DROP TABLE IF EXISTS public.marketing_signals_history'),
    'must drop the history table'
  );
  assert.ok(
    src.includes('DROP COLUMN IF EXISTS sys_period') &&
      src.includes('DROP COLUMN IF EXISTS valid_period'),
    'must drop sys_period and valid_period columns'
  );
  assert.ok(
    src.includes('DROP INDEX IF EXISTS public.idx_marketing_signals_sys_period') &&
      src.includes('DROP INDEX IF EXISTS public.idx_marketing_signals_valid_period') &&
      src.includes('DROP INDEX IF EXISTS public.idx_marketing_signals_site_sys_period'),
    'must drop the three GiST indexes on sys_period/valid_period'
  );
});

test('Phase 4 drop migration rewires recover_stuck_marketing_signals to updated_at', () => {
  const src = readFileSync(DROP_MIGRATION, 'utf8');

  assert.ok(
    src.includes('CREATE OR REPLACE FUNCTION public.recover_stuck_marketing_signals'),
    'migration must replace the stuck-signal recoverer'
  );
  assert.ok(
    src.includes('ms.updated_at < cutoff.v_cutoff'),
    'recoverer must use marketing_signals.updated_at as the "last touched" clock'
  );
  assert.ok(
    !/lower\(\s*sys_period\s*\)/.test(src),
    'recoverer must no longer reference lower(sys_period)'
  );
});

test('Phase 4 drop migration rewires reset_business_data_before_cutoff_v1 away from history', () => {
  const src = readFileSync(DROP_MIGRATION, 'utf8');

  assert.ok(
    src.includes('CREATE OR REPLACE FUNCTION public.reset_business_data_before_cutoff_v1'),
    'migration must replace the TRT cutoff reset kernel'
  );

  // Isolate the replacement kernel body and assert it no longer touches the
  // dropped history table. Allow the word in the drop section / comments.
  const kernelStart = src.indexOf(
    'CREATE OR REPLACE FUNCTION public.reset_business_data_before_cutoff_v1'
  );
  assert.ok(kernelStart >= 0, 'locate kernel start anchor');
  const kernelEnd = src.indexOf('$$;', kernelStart);
  assert.ok(kernelEnd > kernelStart, 'locate kernel end anchor');
  const kernelBody = src.slice(kernelStart, kernelEnd);

  assert.ok(
    !kernelBody.includes('marketing_signals_history'),
    'reset kernel body must not reference the dropped history table'
  );
});
