/**
 * PR-T1.6 — DB-level conversation_links cross-site guard.
 * Asserts: conversation_links rejects wrong-site call/session/event entity_id values and leaves no orphan link row.
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

async function expectRejectedCrossSiteLink(
  conversationId: string,
  entityType: 'call' | 'session' | 'event',
  entityId: string
): Promise<void> {
  const { count: beforeCount } = await adminClient
    .from('conversation_links')
    .select('*', { count: 'exact', head: true })
    .eq('conversation_id', conversationId)
    .eq('entity_type', entityType)
    .eq('entity_id', entityId);

  assert.equal(beforeCount ?? 0, 0, `fixture must start without ${entityType} cross-site link`);

  const { data, error } = await adminClient
    .from('conversation_links')
    .insert({
      conversation_id: conversationId,
      entity_type: entityType,
      entity_id: entityId,
    })
    .select('id')
    .single();

  assert.equal(data, null, 'failed conversation_links insert must not return a row');
  assert.ok(error, `cross-site ${entityType} link must be rejected`);
  assert.match(
    error?.message ?? '',
    /entity must belong to the same site/i,
    'DB trigger must reject wrong-site entity binding'
  );

  const { count: afterCount } = await adminClient
    .from('conversation_links')
    .select('*', { count: 'exact', head: true })
    .eq('conversation_id', conversationId)
    .eq('entity_type', entityType)
    .eq('entity_id', entityId);

  assert.equal(afterCount ?? 0, 0, `failed ${entityType} link insert must not leave orphan link row`);
}

async function expectRejectedCrossSiteLinkUpdate(
  linkId: string,
  entityType: 'call' | 'session' | 'event',
  foreignEntityId: string,
  expectedEntityId: string
): Promise<void> {
  const { data, error } = await adminClient
    .from('conversation_links')
    .update({
      entity_id: foreignEntityId,
    })
    .eq('id', linkId)
    .select('id')
    .single();

  assert.equal(data, null, 'failed conversation_links update must not return a row');
  assert.ok(error, `cross-site ${entityType} link update must be rejected`);
  assert.match(
    error?.message ?? '',
    /entity must belong to the same site/i,
    'DB trigger must reject wrong-site entity rebinding on update'
  );

  const { data: linkAfter, error: linkAfterError } = await adminClient
    .from('conversation_links')
    .select('id, entity_type, entity_id')
    .eq('id', linkId)
    .single();

  assert.ifError(linkAfterError);
  assert.ok(linkAfter, 'link row must still exist after rejected update');
  assert.equal(linkAfter.entity_type, entityType, 'rejected update must preserve entity type');
  assert.equal(linkAfter.entity_id, expectedEntityId, 'rejected update must preserve original entity binding');
}

test('conversation_links rejects cross-site call/session/event entities and leaves no orphan links', async (t) => {
  const env = requireStrictEnv();
  if (env.skip) {
    t.skip(env.reason);
    return;
  }

  const sites = await resolveTwoDistinctSites();
  if (!sites) {
    t.skip('At least two site rows are required for cross-site conversation_links integration test');
    return;
  }

  const { siteA, siteB } = sites;
  const createdMonth = currentMonthStartIsoDate();

  const { data: conversationRow, error: conversationError } = await adminClient
    .from('conversations')
    .insert({
      site_id: siteA,
      status: 'OPEN',
    })
    .select('id')
    .single();

  if (conversationError || !conversationRow?.id) {
    t.skip(`Could not insert siteA conversation fixture: ${conversationError?.message ?? 'no data'}`);
    return;
  }

  const conversationId = conversationRow.id;
  t.after(async () => {
    await adminClient.from('conversations').delete().eq('id', conversationId);
  });

  const { data: sessionRow, error: sessionError } = await adminClient
    .from('sessions')
    .insert({
      id: randomUUID(),
      site_id: siteB,
      created_month: createdMonth,
      entry_page: 'https://example.com/conversation-link-cross-site',
    })
    .select('id, created_month')
    .single();

  if (sessionError || !sessionRow?.id) {
    t.skip(`Could not insert foreign-site session fixture: ${sessionError?.message ?? 'no data'}`);
    return;
  }

  const foreignSessionId = sessionRow.id;
  t.after(async () => {
    await adminClient
      .from('sessions')
      .delete()
      .eq('id', foreignSessionId)
      .eq('created_month', createdMonth);
  });

  const { data: callRow, error: callError } = await adminClient
    .from('calls')
    .insert({
      site_id: siteB,
      phone_number: `+90555${String(Date.now()).slice(-7)}`,
      session_created_month: createdMonth,
      source: 'manual',
      status: 'intent',
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

  const { data: eventRow, error: eventError } = await adminClient
    .from('events')
    .insert({
      session_id: foreignSessionId,
      session_month: createdMonth,
      site_id: siteB,
      url: 'https://example.com/conversation-link-cross-site',
      event_category: 'interaction',
      event_action: 'view',
      metadata: { crossSite: true },
    })
    .select('id')
    .single();

  if (eventError || !eventRow?.id) {
    t.skip(`Could not insert foreign-site event fixture: ${eventError?.message ?? 'no data'}`);
    return;
  }

  const foreignEventId = eventRow.id;
  t.after(async () => {
    await adminClient
      .from('events')
      .delete()
      .eq('id', foreignEventId)
      .eq('session_month', createdMonth);
  });

  await expectRejectedCrossSiteLink(conversationId, 'call', foreignCallId);
  await expectRejectedCrossSiteLink(conversationId, 'session', foreignSessionId);
  await expectRejectedCrossSiteLink(conversationId, 'event', foreignEventId);
});

test('conversation_links update rejects cross-site call/session/event rebinding and preserves existing link rows', async (t) => {
  const env = requireStrictEnv();
  if (env.skip) {
    t.skip(env.reason);
    return;
  }

  const sites = await resolveTwoDistinctSites();
  if (!sites) {
    t.skip('At least two site rows are required for cross-site conversation_links integration test');
    return;
  }

  const { siteA, siteB } = sites;
  const createdMonth = currentMonthStartIsoDate();

  const { data: conversationRow, error: conversationError } = await adminClient
    .from('conversations')
    .insert({
      site_id: siteA,
      status: 'OPEN',
    })
    .select('id')
    .single();

  if (conversationError || !conversationRow?.id) {
    t.skip(`Could not insert siteA conversation fixture: ${conversationError?.message ?? 'no data'}`);
    return;
  }

  const conversationId = conversationRow.id;
  t.after(async () => {
    await adminClient.from('conversations').delete().eq('id', conversationId);
  });

  const { data: localSessionRow, error: localSessionError } = await adminClient
    .from('sessions')
    .insert({
      id: randomUUID(),
      site_id: siteA,
      created_month: createdMonth,
      entry_page: 'https://example.com/conversation-link-local',
    })
    .select('id, created_month')
    .single();

  if (localSessionError || !localSessionRow?.id) {
    t.skip(`Could not insert siteA session fixture: ${localSessionError?.message ?? 'no data'}`);
    return;
  }

  const localSessionId = localSessionRow.id;
  t.after(async () => {
    await adminClient
      .from('sessions')
      .delete()
      .eq('id', localSessionId)
      .eq('created_month', createdMonth);
  });

  const { data: foreignSessionRow, error: foreignSessionError } = await adminClient
    .from('sessions')
    .insert({
      id: randomUUID(),
      site_id: siteB,
      created_month: createdMonth,
      entry_page: 'https://example.com/conversation-link-foreign',
    })
    .select('id, created_month')
    .single();

  if (foreignSessionError || !foreignSessionRow?.id) {
    t.skip(`Could not insert foreign-site session fixture: ${foreignSessionError?.message ?? 'no data'}`);
    return;
  }

  const foreignSessionId = foreignSessionRow.id;
  t.after(async () => {
    await adminClient
      .from('sessions')
      .delete()
      .eq('id', foreignSessionId)
      .eq('created_month', createdMonth);
  });

  const { data: localCallRow, error: localCallError } = await adminClient
    .from('calls')
    .insert({
      site_id: siteA,
      phone_number: `+90555${String(Date.now()).slice(-7)}`,
      session_created_month: createdMonth,
      source: 'manual',
      status: 'intent',
    })
    .select('id')
    .single();

  if (localCallError || !localCallRow?.id) {
    t.skip(`Could not insert siteA call fixture: ${localCallError?.message ?? 'no data'}`);
    return;
  }

  const localCallId = localCallRow.id;
  t.after(async () => {
    await adminClient.from('calls').delete().eq('id', localCallId);
  });

  const { data: foreignCallRow, error: foreignCallError } = await adminClient
    .from('calls')
    .insert({
      site_id: siteB,
      phone_number: `+90554${String(Date.now()).slice(-7)}`,
      session_created_month: createdMonth,
      source: 'manual',
      status: 'intent',
    })
    .select('id')
    .single();

  if (foreignCallError || !foreignCallRow?.id) {
    t.skip(`Could not insert foreign-site call fixture: ${foreignCallError?.message ?? 'no data'}`);
    return;
  }

  const foreignCallId = foreignCallRow.id;
  t.after(async () => {
    await adminClient.from('calls').delete().eq('id', foreignCallId);
  });

  const { data: localEventRow, error: localEventError } = await adminClient
    .from('events')
    .insert({
      session_id: localSessionId,
      session_month: createdMonth,
      site_id: siteA,
      url: 'https://example.com/conversation-link-local',
      event_category: 'interaction',
      event_action: 'view',
      metadata: { local: true },
    })
    .select('id')
    .single();

  if (localEventError || !localEventRow?.id) {
    t.skip(`Could not insert siteA event fixture: ${localEventError?.message ?? 'no data'}`);
    return;
  }

  const localEventId = localEventRow.id;
  t.after(async () => {
    await adminClient
      .from('events')
      .delete()
      .eq('id', localEventId)
      .eq('session_month', createdMonth);
  });

  const { data: foreignEventRow, error: foreignEventError } = await adminClient
    .from('events')
    .insert({
      session_id: foreignSessionId,
      session_month: createdMonth,
      site_id: siteB,
      url: 'https://example.com/conversation-link-foreign',
      event_category: 'interaction',
      event_action: 'view',
      metadata: { foreign: true },
    })
    .select('id')
    .single();

  if (foreignEventError || !foreignEventRow?.id) {
    t.skip(`Could not insert foreign-site event fixture: ${foreignEventError?.message ?? 'no data'}`);
    return;
  }

  const foreignEventId = foreignEventRow.id;
  t.after(async () => {
    await adminClient
      .from('events')
      .delete()
      .eq('id', foreignEventId)
      .eq('session_month', createdMonth);
  });

  const { data: callLinkRow, error: callLinkError } = await adminClient
    .from('conversation_links')
    .insert({
      conversation_id: conversationId,
      entity_type: 'call',
      entity_id: localCallId,
    })
    .select('id')
    .single();

  if (callLinkError || !callLinkRow?.id) {
    t.skip(`Could not insert siteA call link fixture: ${callLinkError?.message ?? 'no data'}`);
    return;
  }

  const { data: sessionLinkRow, error: sessionLinkError } = await adminClient
    .from('conversation_links')
    .insert({
      conversation_id: conversationId,
      entity_type: 'session',
      entity_id: localSessionId,
    })
    .select('id')
    .single();

  if (sessionLinkError || !sessionLinkRow?.id) {
    t.skip(`Could not insert siteA session link fixture: ${sessionLinkError?.message ?? 'no data'}`);
    return;
  }

  const { data: eventLinkRow, error: eventLinkError } = await adminClient
    .from('conversation_links')
    .insert({
      conversation_id: conversationId,
      entity_type: 'event',
      entity_id: localEventId,
    })
    .select('id')
    .single();

  if (eventLinkError || !eventLinkRow?.id) {
    t.skip(`Could not insert siteA event link fixture: ${eventLinkError?.message ?? 'no data'}`);
    return;
  }

  await expectRejectedCrossSiteLinkUpdate(callLinkRow.id, 'call', foreignCallId, localCallId);
  await expectRejectedCrossSiteLinkUpdate(sessionLinkRow.id, 'session', foreignSessionId, localSessionId);
  await expectRejectedCrossSiteLinkUpdate(eventLinkRow.id, 'event', foreignEventId, localEventId);
});
