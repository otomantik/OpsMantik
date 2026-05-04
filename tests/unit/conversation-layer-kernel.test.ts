/**
 * Conversation Layer kernel hardening: queue attribution immutability + entity site trigger.
 * Contract is asserted against `schema_utf8.sql` (incremental migration filenames drifted).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { getSchemaUtf8, schemaUtf8Slice } from '@/tests/helpers/schema-utf8-contract';

test('kernel hardening migration exists and defines queue attribution immutability', () => {
  const src = schemaUtf8Slice(
    'CREATE OR REPLACE FUNCTION "public"."update_offline_conversion_queue_attribution"',
    'CREATE OR REPLACE FUNCTION "public"."update_queue_status_locked"'
  );
  assert.ok(src.includes('immutable_after_sent'), 'RPC raises immutable_after_sent when queue not mutable');
  assert.ok(
    src.includes("'QUEUED'") && src.includes("'PROCESSING'"),
    'RPC only updates when status in QUEUED or PROCESSING'
  );
  assert.ok(src.includes('v_queue_status NOT IN'), 'RPC checks queue status before update');
});

test('kernel hardening migration defines conversation_links entity site trigger', () => {
  const fnSrc = schemaUtf8Slice(
    'CREATE OR REPLACE FUNCTION "public"."conversation_links_entity_site_check"',
    'CREATE OR REPLACE FUNCTION "public"."conversations_primary_entity_site_check"'
  );
  assert.ok(fnSrc.includes('conversation_links_entity_site_check'), 'trigger function exists');
  assert.ok(fnSrc.includes('calls') && fnSrc.includes('sessions') && fnSrc.includes('events'), 'checks calls, sessions, events');
  const full = getSchemaUtf8();
  assert.ok(full.includes('conversation_links_entity_site_trigger'), 'trigger attached');
  assert.ok(
    full.includes('BEFORE INSERT OR UPDATE OF "conversation_id", "entity_type", "entity_id" ON "public"."conversation_links"'),
    'trigger fires on insert and update of link keys'
  );
});
