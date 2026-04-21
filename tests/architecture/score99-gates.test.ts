import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function mustExist(rel: string) {
  assert.equal(fs.existsSync(path.join(root, rel)), true, `missing required artifact: ${rel}`);
}

test('score99 gate: ack receipt + atomic finalize migrations exist', () => {
  mustExist('supabase/migrations/20261221010000_ack_receipt_ledger_and_atomic_finalize.sql');
});

test('score99 gate: total routing ledger migration exists', () => {
  mustExist('supabase/migrations/20261221020000_total_routing_ledger.sql');
});

test('score99 gate: liveness and convergence guards exist', () => {
  mustExist('lib/oci/liveness-watchdogs.ts');
  mustExist('lib/oci/convergence-gates.ts');
  mustExist('lib/oci/conservation.ts');
});
