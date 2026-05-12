import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATION = join(
  process.cwd(),
  'supabase',
  'migrations',
  '20261229120000_append_script_transition_batch_processing_source_guard.sql'
);

test('PR-D: append_script_transition_batch migration requires PROCESSING source rows', () => {
  const src = readFileSync(MIGRATION, 'utf8');
  assert.ok(src.includes('CREATE OR REPLACE FUNCTION public.append_script_transition_batch'));
  assert.ok(src.includes("WHERE q.status = 'PROCESSING'"), 'ledger append must filter to PROCESSING source status');
  assert.ok(src.includes("auth.role() IS DISTINCT FROM 'service_role'"), 'service_role guard must remain');
});
