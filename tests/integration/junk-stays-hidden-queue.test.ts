/**
 * Queue visibility: Çöp tıklandıktan sonra junk satır geri gelmemeli,
 * ama aynı session'daki farklı pending satır görünmez olmamalı.
 * - apply_call_action_v1(call_id, 'junk') ile satır junk olur.
 * - Aynı session'daki diğer intent satırı lite RPC'de görünmeye devam eder.
 *
 * Requires: JUNK_FLOW_TEST_SITE_ID (UUID) veya STRICT_INGEST_TEST_SITE_ID, Supabase env.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from 'dotenv';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { adminClient } from '@/lib/supabase/admin';
import { requireStrictEnv, resolveStrictTestSiteId } from '@/tests/helpers/strict-ingest-helpers';

config({ path: join(process.cwd(), '.env.local') });

test('junk flow: apply_call_action_v1 junk hides only junked row, not same-session sibling', async (t) => {
  const env = requireStrictEnv();
  if (env.skip) {
    t.skip(env.reason);
    return;
  }

  const siteId = await resolveStrictTestSiteId(['JUNK_FLOW_TEST_SITE_ID']);
  if (!siteId) {
    t.skip('No test site available for junk flow integration test');
    return;
  }
  const sessionId = randomUUID();
  const now = new Date();
  const fromIso = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const toIso = new Date(now.getTime() + 60 * 60 * 1000).toISOString();

  // 1) Insert two calls, same session, status intent (simulate queue)
  const { data: call1, error: ins1 } = await adminClient
    .from('calls')
    .insert({
      site_id: siteId,
      phone_number: '+905551110001',
      source: 'click',
      status: 'intent',
      matched_session_id: sessionId,
      intent_stamp: `session:${sessionId}-a`,
      intent_action: 'phone',
      intent_target: '+905551110001',
    })
    .select('id, status, matched_session_id')
    .single();

  if (ins1 || !call1) {
    t.skip(`Insert call1 failed: ${(ins1 as Error)?.message ?? 'no data'}`);
    return;
  }

  const { data: call2, error: ins2 } = await adminClient
    .from('calls')
    .insert({
      site_id: siteId,
      phone_number: '+905551110002',
      source: 'click',
      status: 'intent',
      matched_session_id: sessionId,
      intent_stamp: `session:${sessionId}-b`,
      intent_action: 'whatsapp',
      intent_target: '+905551110002',
    })
    .select('id, status, matched_session_id')
    .single();

  if (ins2 || !call2) {
    await adminClient.from('calls').delete().eq('id', (call1 as { id: string }).id);
    t.skip(`Insert call2 failed: ${(ins2 as Error)?.message ?? 'no data'}`);
    return;
  }

  const call1Id = (call1 as { id: string }).id;
  const call2Id = (call2 as { id: string }).id;

  t.after(async () => {
    await adminClient.from('calls').delete().eq('id', call1Id);
    await adminClient.from('calls').delete().eq('id', call2Id);
  });

  // 2) Before junk: lite should return both (or at least our session's calls)
  const { data: beforeLite, error: errBefore } = await adminClient.rpc('get_recent_intents_lite_v1', {
    p_site_id: siteId,
    p_date_from: fromIso,
    p_date_to: toIso,
    p_limit: 100,
    p_ads_only: false,
  });

  assert.ifError(errBefore);
  const beforeList = Array.isArray(beforeLite) ? beforeLite : [];
  const beforeIds = beforeList.map((r: { id?: string }) => r?.id).filter(Boolean);
  assert.ok(
    beforeIds.includes(call1Id) || beforeIds.includes(call2Id),
    'before junk: at least one of our calls should appear in lite'
  );

  // 3) Junk call1 via apply_call_action_v1 (system actor for service_role test)
  const { data: updated, error: junkErr } = await adminClient.rpc('apply_call_action_v1', {
    p_call_id: call1Id,
    p_action_type: 'junk',
    p_payload: { lead_score: 0 },
    p_actor_type: 'system',
    p_actor_id: null,
    p_metadata: { test: 'junk-stays-hidden' },
    p_version: null,
  });

  assert.ifError(junkErr);
  const updatedRow = Array.isArray(updated) ? updated[0] : updated;
  assert.ok(updatedRow, 'apply_call_action_v1 must return updated row');
  assert.equal((updatedRow as { status?: string })?.status, 'junk', 'call1 status must be junk');

  // 4) After junk: lite must NOT return call1, but must keep call2 visible.
  const { data: afterLite, error: errAfter } = await adminClient.rpc('get_recent_intents_lite_v1', {
    p_site_id: siteId,
    p_date_from: fromIso,
    p_date_to: toIso,
    p_limit: 100,
    p_ads_only: false,
  });

  assert.ifError(errAfter);
  const afterList = Array.isArray(afterLite) ? afterLite : [];
  const afterIds = afterList.map((r: { id?: string }) => r?.id).filter(Boolean);
  assert.ok(!afterIds.includes(call1Id), 'after junk: junked call must not appear in lite');
  assert.ok(afterIds.includes(call2Id), 'after junk: same-session pending call must remain visible in lite');
});
