/**
 * PR-T1.5 — DB-level sales create guard.
 * Asserts: sales write rejects wrong-site conversation_id and leaves no orphan sale row.
 * Requires: Supabase env and at least two site rows in DB.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from 'dotenv';
import { join } from 'node:path';
import { adminClient } from '@/lib/supabase/admin';
import { requireStrictEnv } from '@/tests/helpers/strict-ingest-helpers';
import { resolveTwoDistinctSites } from '@/tests/helpers/tenant-boundary-helpers';

config({ path: join(process.cwd(), '.env.local') });

test('sales insert rejects cross-site conversation_id and leaves no orphan sale row', async (t) => {
  const env = requireStrictEnv();
  if (env.skip) {
    t.skip(env.reason);
    return;
  }

  const sites = await resolveTwoDistinctSites();
  if (!sites) {
    t.skip('At least two site rows are required for cross-site sales integration test');
    return;
  }

  const { siteA, siteB } = sites;
  const { data: conversationRow, error: conversationError } = await adminClient
    .from('conversations')
    .insert({
      site_id: siteB,
      status: 'OPEN',
    })
    .select('id')
    .single();

  if (conversationError || !conversationRow?.id) {
    t.skip(`Could not insert foreign-site conversation fixture: ${conversationError?.message ?? 'no data'}`);
    return;
  }

  const foreignConversationId = conversationRow.id;
  t.after(async () => {
    await adminClient.from('conversations').delete().eq('id', foreignConversationId);
  });

  const occurredAt = new Date().toISOString();
  const { count: beforeCount } = await adminClient
    .from('sales')
    .select('*', { count: 'exact', head: true })
    .eq('site_id', siteA)
    .eq('conversation_id', foreignConversationId);

  assert.equal(beforeCount ?? 0, 0, 'fixture must start with no sale referencing the foreign conversation');

  const { data, error } = await adminClient
    .from('sales')
    .insert({
      site_id: siteA,
      conversation_id: foreignConversationId,
      occurred_at: occurredAt,
      amount_cents: 12345,
      currency: 'TRY',
      status: 'DRAFT',
    })
    .select('id')
    .single();

  assert.equal(data, null, 'failed sales insert must not return a sale payload');
  assert.ok(error, 'cross-site conversation_id must be rejected');
  assert.match(
    error?.message ?? '',
    /conversation_id must belong to the same site/i,
    'DB trigger must reject wrong-site conversation binding'
  );

  const { count: afterCount } = await adminClient
    .from('sales')
    .select('*', { count: 'exact', head: true })
    .eq('site_id', siteA)
    .eq('conversation_id', foreignConversationId);

  assert.equal(afterCount ?? 0, 0, 'failed insert must not leave orphan sale row');
});

test('sales update rejects cross-site conversation_id and preserves existing row binding', async (t) => {
  const env = requireStrictEnv();
  if (env.skip) {
    t.skip(env.reason);
    return;
  }

  const sites = await resolveTwoDistinctSites();
  if (!sites) {
    t.skip('At least two site rows are required for cross-site sales integration test');
    return;
  }

  const { siteA, siteB } = sites;
  const { data: foreignConversationRow, error: foreignConversationError } = await adminClient
    .from('conversations')
    .insert({
      site_id: siteB,
      status: 'OPEN',
    })
    .select('id')
    .single();

  if (foreignConversationError || !foreignConversationRow?.id) {
    t.skip(`Could not insert foreign-site conversation fixture: ${foreignConversationError?.message ?? 'no data'}`);
    return;
  }

  const foreignConversationId = foreignConversationRow.id;
  t.after(async () => {
    await adminClient.from('conversations').delete().eq('id', foreignConversationId);
  });

  const { data: saleRow, error: saleError } = await adminClient
    .from('sales')
    .insert({
      site_id: siteA,
      occurred_at: new Date().toISOString(),
      amount_cents: 67890,
      currency: 'TRY',
      status: 'DRAFT',
    })
    .select('id, conversation_id')
    .single();

  if (saleError || !saleRow?.id) {
    t.skip(`Could not insert siteA sale fixture: ${saleError?.message ?? 'no data'}`);
    return;
  }

  const saleId = saleRow.id;
  t.after(async () => {
    await adminClient.from('sales').delete().eq('id', saleId);
  });

  assert.equal(saleRow.conversation_id ?? null, null, 'fixture sale must start detached from any conversation');

  const { data, error } = await adminClient
    .from('sales')
    .update({
      conversation_id: foreignConversationId,
    })
    .eq('id', saleId)
    .select('id')
    .single();

  assert.equal(data, null, 'failed sales update must not return a sale payload');
  assert.ok(error, 'cross-site conversation_id update must be rejected');
  assert.match(
    error?.message ?? '',
    /conversation_id must belong to the same site/i,
    'DB trigger must reject wrong-site conversation binding on update'
  );

  const { data: saleAfter, error: saleAfterError } = await adminClient
    .from('sales')
    .select('id, conversation_id')
    .eq('id', saleId)
    .single();

  assert.ifError(saleAfterError);
  assert.ok(saleAfter, 'sale row must still exist after rejected update');
  assert.equal(saleAfter.conversation_id ?? null, null, 'rejected update must preserve original conversation binding');
});
