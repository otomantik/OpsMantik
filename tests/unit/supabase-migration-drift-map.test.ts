import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

test('migration drift policy documents known local<->remote equivalent versions', () => {
  const doc = readFileSync(
    join(process.cwd(), 'docs', 'OPS', 'SUPABASE_MIGRATION_DRIFT_POLICY.md'),
    'utf8'
  );

  const requiredLocal = [
    '20261223030000_ack_receipt_stale_registered_sweep_index.sql',
    '20261224000000_intent_coalesce_window_professional_v1.sql',
    '20261225000000_intent_coalesce_window_tighten_v1.sql',
    '20261226000000_oci_transition_grants_revoke_apply_call_action_strict.sql',
  ];

  for (const file of requiredLocal) {
    assert.ok(doc.includes(file), `drift policy missing local migration mapping: ${file}`);
  }
});
