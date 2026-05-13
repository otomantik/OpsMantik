import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

test('close_stale_uploaded_conversions ledger migration: worker batch + SKIP LOCKED + service_role only', () => {
  const sql = readFileSync(
    join(process.cwd(), 'supabase', 'migrations', '20261231130000_close_stale_uploaded_conversions_ledger_v1.sql'),
    'utf8'
  );
  assert.match(sql, /append_worker_transition_batch_v2/);
  assert.match(sql, /FOR UPDATE SKIP LOCKED/);
  assert.match(sql, /status = 'UPLOADED'/);
  assert.match(sql, /'COMPLETED_UNVERIFIED'/);
  assert.match(sql, /service_role/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.close_stale_uploaded_conversions/);
});
