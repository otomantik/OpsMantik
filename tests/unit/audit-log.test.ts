/**
 * Unit tests for appendAuditLog (PR-G5). Mocks Supabase client.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendAuditLog } from '@/lib/audit/audit-log';
import type { SupabaseClient } from '@supabase/supabase-js';

function mockClient(insertResult: { error: { message: string } | null }): SupabaseClient {
  const chain = {
    insert: () => Promise.resolve({ data: null, error: insertResult.error }),
  };
  return { from: () => chain } as unknown as SupabaseClient;
}

test('appendAuditLog: success returns { ok: true }', async () => {
  const client = mockClient({ error: null });
  const out = await appendAuditLog(client, {
    actor_type: 'cron',
    action: 'invoice_freeze',
    resource_type: 'invoice_snapshot',
    resource_id: '2026-01',
    payload: { frozen: 5, failed: 0 },
  });
  assert.equal(out.ok, true);
  assert.equal(out.error, undefined);
});

test('appendAuditLog: insert error returns { ok: false, error }', async () => {
  const client = mockClient({ error: { message: 'permission denied' } });
  const out = await appendAuditLog(client, {
    actor_type: 'user',
    actor_id: '00000000-0000-0000-0000-000000000001',
    action: 'dispute_export',
    site_id: '00000000-0000-0000-0000-000000000002',
    payload: { year_month: '2026-01' },
  });
  assert.equal(out.ok, false);
  assert.equal(out.error, 'permission denied');
});

test('appendAuditLog: optional fields omitted become null/empty', async () => {
  let captured: Record<string, unknown> = {};
  const client = {
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        captured = row;
        return Promise.resolve({ data: null, error: null });
      },
    }),
  } as unknown as SupabaseClient;
  await appendAuditLog(client, {
    actor_type: 'service_role',
    action: 'test_action',
  });
  assert.equal(captured.actor_id, null);
  assert.equal(captured.resource_type, null);
  assert.equal(captured.resource_id, null);
  assert.equal(captured.site_id, null);
  assert.deepEqual(captured.payload, {});
});
