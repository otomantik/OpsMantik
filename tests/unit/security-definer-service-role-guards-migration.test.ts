import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations');

/**
 * Contract: privileged ACK/outbox RPCs fail closed for non-service_role callers
 * (baseline bodies + follow-up REVOKE tightening in migrations).
 */
test('migrations: ACK + finalize_outbox RPCs are service_role-gated and locked down for anon/auth', () => {
  const baseline = readFileSync(join(MIGRATIONS, '00000000000000_baseline_v2.sql'), 'utf8');
  for (const name of ['register_ack_receipt_v1', 'complete_ack_receipt_v1'] as const) {
    const idx = baseline.indexOf(`FUNCTION public.${name}`);
    assert.ok(idx !== -1, `baseline must define ${name}`);
    const slice = baseline.slice(idx, idx + 900);
    assert.ok(
      slice.includes("auth.role() IS DISTINCT FROM 'service_role'"),
      `${name} must include service_role guard`
    );
  }

  const hardening = readFileSync(join(MIGRATIONS, '20260428152000_security_function_hardening.sql'), 'utf8');
  assert.ok(
    hardening.includes('REVOKE EXECUTE ON FUNCTION public.register_ack_receipt_v1(uuid, text, text) FROM PUBLIC'),
    'hardening must revoke register_ack_receipt_v1 from PUBLIC'
  );
  assert.ok(
    hardening.includes('REVOKE EXECUTE ON FUNCTION public.complete_ack_receipt_v1(uuid, jsonb) FROM PUBLIC'),
    'hardening must revoke complete_ack_receipt_v1 from PUBLIC'
  );

  const outbox = readFileSync(join(MIGRATIONS, '20261113000000_outbox_events_table_claim_finalize.sql'), 'utf8');
  const fIdx = outbox.indexOf('FUNCTION public.finalize_outbox_event_v1');
  assert.ok(fIdx !== -1, 'outbox migration must define finalize_outbox_event_v1');
  const fSlice = outbox.slice(fIdx, fIdx + 500);
  assert.ok(
    fSlice.includes("auth.role() IS DISTINCT FROM 'service_role'"),
    'finalize_outbox_event_v1 must include service_role guard'
  );
  assert.ok(
    outbox.includes('REVOKE ALL ON FUNCTION public.finalize_outbox_event_v1(uuid, text, text, integer) FROM PUBLIC'),
    'must revoke finalize_outbox_event_v1 from PUBLIC'
  );
  assert.ok(
    outbox.includes('GRANT EXECUTE ON FUNCTION public.finalize_outbox_event_v1(uuid, text, text, integer) TO service_role'),
    'must grant finalize_outbox_event_v1 to service_role'
  );
});
