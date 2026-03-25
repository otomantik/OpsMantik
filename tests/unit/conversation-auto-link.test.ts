import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildConversationSourceSummary,
  extractConversationPhoneE164,
  resolveIntentConversation,
} from '@/lib/services/conversation-service';

test('conversation auto-link: extracts phone identity from tel and whatsapp targets', () => {
  assert.equal(extractConversationPhoneE164('tel:+90 (532) 123 45 67'), '+905321234567');
  assert.equal(extractConversationPhoneE164('whatsapp:+905321234567'), '+905321234567');
  assert.equal(extractConversationPhoneE164('wa:+905321234567'), '+905321234567');
  assert.equal(extractConversationPhoneE164('https://chat.whatsapp.com/invite-code'), null);
});

test('conversation auto-link: source summary keeps attribution and omits nulls', () => {
  const summary = buildConversationSourceSummary({
    siteId: 'site-1',
    source: 'sync',
    intentAction: 'phone',
    intentTarget: 'tel:+905321234567',
    clickId: 'GCLID-1',
    primarySource: {
      gclid: 'GCLID-1',
      utm_source: 'google',
      referrer: 'google.com',
    },
  });

  assert.deepEqual(summary, {
    source: 'sync',
    intent_action: 'phone',
    intent_target: 'tel:+905321234567',
    click_id: 'GCLID-1',
    gclid: 'GCLID-1',
    utm_source: 'google',
    referrer: 'google.com',
  });
});

test('conversation auto-link: resolver sends phase1 rpc payload', async () => {
  let rpcName = '';
  let rpcArgs: Record<string, unknown> | null = null;

  const conversationId = await resolveIntentConversation(
    {
      siteId: 'site-1',
      source: 'call_event',
      intentAction: 'phone',
      intentTarget: 'tel:+905321234567',
      primaryCallId: 'call-1',
      primarySessionId: 'session-1',
      mizanValue: 42,
      clickId: 'GCLID-1',
      idempotencyKey: 'call_event:event-1',
      primarySource: { gclid: 'GCLID-1' },
    },
    {
      client: {
        rpc: async (fn, args) => {
          rpcName = fn;
          rpcArgs = args;
          return { data: 'conversation-1', error: null };
        },
      },
    }
  );

  assert.equal(conversationId, 'conversation-1');
  assert.equal(rpcName, 'resolve_intent_and_upsert_conversation');
  assert.deepEqual(rpcArgs, {
    p_site_id: 'site-1',
    p_phone_e164: '+905321234567',
    p_customer_hash: null,
    p_primary_call_id: 'call-1',
    p_primary_session_id: 'session-1',
    p_mizan_value: 42,
    p_source_summary: {
      source: 'call_event',
      intent_action: 'phone',
      intent_target: 'tel:+905321234567',
      click_id: 'GCLID-1',
      gclid: 'GCLID-1',
    },
    p_idempotency_key: 'call_event:event-1',
  });
});

test('conversation auto-link: sync, call-event, and probe paths invoke resolver', () => {
  const syncSrc = readFileSync(join(process.cwd(), 'lib', 'ingest', 'process-sync-event.ts'), 'utf8');
  const callEventSrc = readFileSync(join(process.cwd(), 'lib', 'ingest', 'process-call-event.ts'), 'utf8');
  const probeSrc = readFileSync(join(process.cwd(), 'app', 'api', 'intents', 'status', 'route.ts'), 'utf8');

  assert.ok(syncSrc.includes('resolveIntentConversation({'), 'sync flow should auto-link conversations');
  assert.ok(callEventSrc.includes('resolveIntentConversation({'), 'call-event worker should auto-link conversations');
  assert.ok(probeSrc.includes('resolveIntentConversation({'), 'probe flow should auto-link conversations');
});
