/**
 * PR-T1.4 — DB-level conversation create guard.
 * Asserts: atomic create RPC rejects wrong-site primary call/session and leaves no orphan conversation row.
 * Requires: Supabase env and at least two site rows in DB.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from 'dotenv';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { adminClient } from '@/lib/supabase/admin';
import { requireStrictEnv } from '@/tests/helpers/strict-ingest-helpers';
import { currentMonthStartIsoDate, resolveTwoDistinctSites } from '@/tests/helpers/tenant-boundary-helpers';

config({ path: join(process.cwd(), '.env.local') });

test('conversation create RPC rejects cross-site primary call and leaves no orphan conversation', async (t) => {
  const env = requireStrictEnv();
  if (env.skip) {
    t.skip(env.reason);
    return;
  }

  const sites = await resolveTwoDistinctSites();
  if (!sites) {
    t.skip('At least two site rows are required for cross-site conversation integration test');
    return;
  }

  const { siteA, siteB } = sites;
  const sessionCreatedMonth = currentMonthStartIsoDate();
  const { data: callRow, error: callError } = await adminClient
    .from('calls')
    .insert({
      site_id: siteB,
      phone_number: `+90555${String(Date.now()).slice(-7)}`,
      session_created_month: sessionCreatedMonth,
      source: 'click',
      status: 'intent',
      intent_stamp: `cross-site-call:${randomUUID()}`,
      intent_action: 'phone',
      intent_target: `+90555${String(Date.now()).slice(-7)}`,
    })
    .select('id')
    .single();

  if (callError || !callRow?.id) {
    t.skip(`Could not insert foreign-site call fixture: ${callError?.message ?? 'no data'}`);
    return;
  }

  const foreignCallId = callRow.id;
  t.after(async () => {
    await adminClient.from('calls').delete().eq('id', foreignCallId);
  });

  const { count: beforeCount } = await adminClient
    .from('conversations')
    .select('*', { count: 'exact', head: true })
    .eq('site_id', siteA)
    .eq('primary_call_id', foreignCallId);

  assert.equal(beforeCount ?? 0, 0, 'fixture must start with no conversation referencing the foreign call');

  const { data, error } = await adminClient.rpc('create_conversation_with_primary_entity', {
    p_site_id: siteA,
    p_primary_entity_type: 'call',
    p_primary_entity_id: foreignCallId,
    p_primary_source: null,
  });

  assert.equal(data, null, 'failed RPC must not return conversation payload');
  assert.ok(error, 'cross-site primary call must be rejected');
  assert.equal(error?.message, 'primary_entity_site_mismatch');

  const { count: afterCount } = await adminClient
    .from('conversations')
    .select('*', { count: 'exact', head: true })
    .eq('site_id', siteA)
    .eq('primary_call_id', foreignCallId);

  assert.equal(afterCount ?? 0, 0, 'failed create must not leave orphan conversation row');
});

test('conversation create RPC rejects cross-site primary session and leaves no orphan conversation', async (t) => {
  const env = requireStrictEnv();
  if (env.skip) {
    t.skip(env.reason);
    return;
  }

  const sites = await resolveTwoDistinctSites();
  if (!sites) {
    t.skip('At least two site rows are required for cross-site conversation integration test');
    return;
  }

  const { siteA, siteB } = sites;
  const foreignSessionId = randomUUID();
  const createdMonth = currentMonthStartIsoDate();
  const { data: sessionRow, error: sessionError } = await adminClient
    .from('sessions')
    .insert({
      id: foreignSessionId,
      site_id: siteB,
      created_month: createdMonth,
      entry_page: 'https://example.com/cross-site-conversation',
    })
    .select('id, created_month')
    .single();

  if (sessionError || !sessionRow?.id) {
    t.skip(`Could not insert foreign-site session fixture: ${sessionError?.message ?? 'no data'}`);
    return;
  }

  t.after(async () => {
    await adminClient
      .from('sessions')
      .delete()
      .eq('id', foreignSessionId)
      .eq('created_month', createdMonth);
  });

  const { count: beforeCount } = await adminClient
    .from('conversations')
    .select('*', { count: 'exact', head: true })
    .eq('site_id', siteA)
    .eq('primary_session_id', foreignSessionId);

  assert.equal(beforeCount ?? 0, 0, 'fixture must start with no conversation referencing the foreign session');

  const { data, error } = await adminClient.rpc('create_conversation_with_primary_entity', {
    p_site_id: siteA,
    p_primary_entity_type: 'session',
    p_primary_entity_id: foreignSessionId,
    p_primary_source: null,
  });

  assert.equal(data, null, 'failed RPC must not return conversation payload');
  assert.ok(error, 'cross-site primary session must be rejected');
  assert.equal(error?.message, 'primary_entity_site_mismatch');

  const { count: afterCount } = await adminClient
    .from('conversations')
    .select('*', { count: 'exact', head: true })
    .eq('site_id', siteA)
    .eq('primary_session_id', foreignSessionId);

  assert.equal(afterCount ?? 0, 0, 'failed create must not leave orphan conversation row');
});
