/**
 * Conversation Layer kernel hardening: RPC immutability (queue attribution after COMPLETED/FAILED).
 * Asserts migration and RPC contract.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATION_NAME = '20260218110000_conversation_layer_kernel_hardening.sql';
const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
const migrationPath = join(migrationsDir, MIGRATION_NAME);

test('kernel hardening migration exists and defines queue attribution immutability', () => {
  const src = readFileSync(migrationPath, 'utf8');
  assert.ok(src.includes('immutable_after_sent'), 'RPC raises immutable_after_sent when queue not mutable');
  assert.ok(
    src.includes("'QUEUED'") && src.includes("'PROCESSING'"),
    'RPC only updates when status in QUEUED or PROCESSING'
  );
  assert.ok(src.includes('v_queue_status NOT IN'), 'RPC checks queue status before update');
});

test('kernel hardening migration defines conversation_links entity site trigger', () => {
  const src = readFileSync(migrationPath, 'utf8');
  assert.ok(src.includes('conversation_links_entity_site_check'), 'trigger function exists');
  assert.ok(src.includes('conversation_links_entity_site_trigger'), 'trigger attached');
  assert.ok(src.includes('BEFORE INSERT OR UPDATE'), 'trigger fires on insert and update');
  assert.ok(src.includes('calls') && src.includes('sessions') && src.includes('events'), 'checks calls, sessions, events');
});
