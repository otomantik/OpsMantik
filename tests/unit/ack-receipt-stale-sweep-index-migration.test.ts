import test from 'node:test';
import assert from 'node:assert/strict';
import { readMigrationByContractHints } from '@/tests/helpers/migration-contract-resolver';

test('migration 20261223030000 adds partial index for stale ack receipt sweep', () => {
  const { source: migration } = readMigrationByContractHints([
    'ack_receipt_ledger_stale_registered_created_idx',
    "WHERE apply_state = 'REGISTERED'",
    'result_snapshot IS NULL',
  ]);
  assert.ok(migration.includes('ack_receipt_ledger_stale_registered_created_idx'));
  assert.ok(migration.includes("WHERE apply_state = 'REGISTERED'"));
  assert.ok(migration.includes('result_snapshot IS NULL'));
});
