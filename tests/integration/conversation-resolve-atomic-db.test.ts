/**
 * DB-backed proof that conversation resolve stays atomic when sale linking is invalid.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from 'dotenv';
import { join } from 'node:path';
import { adminClient } from '@/lib/supabase/admin';
import { requireStrictEnv, resolveStrictTestSiteId } from '@/tests/helpers/strict-ingest-helpers';

config({ path: join(process.cwd(), '.env.local') });

test('resolve_conversation_with_sale_link rejects already-linked sale and preserves original state', async (t) => {
  const env = requireStrictEnv();
  if (env.skip) {
    t.skip(env.reason);
    return;
  }

  const siteId = await resolveStrictTestSiteId();
  if (!siteId) {
    t.skip('No test site available for conversation resolve integration test');
    return;
  }

  const { data: targetConversation } = await adminClient
    .from('conversations')
    .insert({ site_id: siteId, status: 'OPEN' })
    .select('id, status')
    .single();
  const { data: linkedConversation } = await adminClient
    .from('conversations')
    .insert({ site_id: siteId, status: 'OPEN' })
    .select('id')
    .single();

  if (!targetConversation?.id || !linkedConversation?.id) {
    t.skip('Could not create conversation fixtures');
    return;
  }

  const { data: saleRow, error: saleError } = await adminClient
    .from('sales')
    .insert({
      site_id: siteId,
      conversation_id: linkedConversation.id,
      occurred_at: new Date().toISOString(),
      amount_cents: 25000,
      currency: 'TRY',
      status: 'DRAFT',
      external_ref: `resolve-atomic-${Date.now()}`,
    })
    .select('id, conversation_id')
    .single();

  if (saleError || !saleRow?.id) {
    t.skip(`Could not create sale fixture: ${saleError?.message ?? 'no data'}`);
    return;
  }

  t.after(async () => {
    await adminClient.from('sales').delete().eq('id', saleRow.id);
    await adminClient.from('conversations').delete().in('id', [targetConversation.id, linkedConversation.id]);
  });

  const { data, error } = await adminClient.rpc('resolve_conversation_with_sale_link', {
    p_conversation_id: targetConversation.id,
    p_status: 'WON',
    p_note: 'should rollback',
    p_sale_id: saleRow.id,
  });

  assert.equal(data, null, 'failed resolve must not return payload');
  assert.ok(error, 'already-linked sale must be rejected');
  assert.equal(error?.message, 'sale_already_linked_elsewhere');

  const { data: conversationAfter } = await adminClient
    .from('conversations')
    .select('status, note')
    .eq('id', targetConversation.id)
    .single();
  const { data: saleAfter } = await adminClient
    .from('sales')
    .select('conversation_id')
    .eq('id', saleRow.id)
    .single();

  assert.equal(conversationAfter?.status, 'OPEN', 'failed resolve must preserve original conversation status');
  assert.equal(conversationAfter?.note ?? null, null, 'failed resolve must not persist note');
  assert.equal(saleAfter?.conversation_id, linkedConversation.id, 'failed resolve must preserve sale binding');
});
