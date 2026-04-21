import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('migration 20261223030000 adds partial index for stale ack receipt sweep', () => {
  const migration = readFileSync(
    join(process.cwd(), 'supabase', 'migrations', '20261223030000_ack_receipt_ledger_stale_sweep_index.sql'),
    'utf8'
  );
  assert.ok(migration.includes('ack_receipt_ledger_stale_registered_created_idx'));
  assert.ok(migration.includes("WHERE apply_state = 'REGISTERED'"));
  assert.ok(migration.includes('result_snapshot IS NULL'));
});
