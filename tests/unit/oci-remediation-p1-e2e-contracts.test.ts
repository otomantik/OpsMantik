import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { planPanelStageOciEnqueue } from '@/lib/oci/enqueue-panel-stage-outbox';
import type { PanelReturnedCall } from '@/lib/oci/enqueue-panel-stage-outbox';

test('merged child never selects insert plan', () => {
  const call: PanelReturnedCall = {
    id: '11111111-1111-4111-8111-111111111111',
    site_id: '22222222-2222-4222-8222-222222222222',
    status: 'contacted',
    matched_session_id: '33333333-3333-4333-8333-333333333333',
    merged_into_call_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  };
  const plan = planPanelStageOciEnqueue({
    call,
    primary: { gclid: 'x', wbraid: null, gbraid: null },
    intentPrecursorEnabled: false,
  });
  assert.equal(plan.outcome, 'reconcile');
});

test('SSOT migration documents BLOCKED_PRECEDING_SIGNALS', () => {
  const p = join(process.cwd(), 'supabase', 'migrations', '20260503100000_oci_ssot_blocked_and_reconciliation.sql');
  const sql = readFileSync(p, 'utf8');
  assert.ok(sql.includes('BLOCKED_PRECEDING_SIGNALS'), 'blocked preceding lane must remain documented in SSOT migration');
});
