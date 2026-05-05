import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

test('apply_call_action_v2 strict migration rejects unknown stage', () => {
  const p = join(
    process.cwd(),
    'supabase',
    'migrations',
    '20261226000000_oci_transition_grants_revoke_apply_call_action_strict.sql'
  );
  const sql = readFileSync(p, 'utf8');
  assert.match(sql, /MESSAGE = 'invalid_stage'/);
});
