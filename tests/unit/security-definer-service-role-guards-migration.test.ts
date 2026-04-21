import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Contract: privileged ACK/outbox/cron RPCs must fail closed for non-service_role callers
 * (Panoptic Phase 1 — DB auth symmetry with adminClient-only app paths).
 */
test('migration 20261223010000 adds service_role guards and explicit grants for ACK/outbox ops RPCs', () => {
  const migration = readFileSync(
    join(
      process.cwd(),
      'supabase',
      'migrations',
      '20261223010000_ack_outbox_ops_service_role_guards.sql'
    ),
    'utf8'
  );

  const mustGuard = [
    'register_ack_receipt_v1',
    'complete_ack_receipt_v1',
    'finalize_outbox_event_v1',
    'ops_db_now_v1',
    'try_acquire_cron_lock_v1',
    'sweep_stale_ack_receipts_v1',
  ] as const;

  for (const name of mustGuard) {
    assert.ok(
      migration.includes(`FUNCTION public.${name}`),
      `migration must replace ${name}`
    );
    const idx = migration.indexOf(`FUNCTION public.${name}`);
    const slice = migration.slice(idx, idx + 1200);
    assert.ok(
      slice.includes("auth.role() IS DISTINCT FROM 'service_role'"),
      `${name} must include service_role guard near definition`
    );
  }

  assert.ok(
    migration.includes('GRANT EXECUTE ON FUNCTION public.register_ack_receipt_v1'),
    'must grant register_ack_receipt_v1 to service_role'
  );
  assert.ok(
    migration.includes('REVOKE ALL ON FUNCTION public.register_ack_receipt_v1'),
    'must revoke register_ack_receipt_v1 from PUBLIC'
  );
  assert.ok(
    migration.includes('REVOKE ALL ON FUNCTION public.complete_ack_receipt_v1(uuid, jsonb)'),
    'complete_ack_receipt_v1 revoke must use exact (uuid, jsonb) signature'
  );
});
