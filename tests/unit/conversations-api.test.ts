/**
 * Conversation API: contract/source tests (no Next request context).
 * Auth and body validation asserted via source inspection.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const createPath = join(process.cwd(), 'app', 'api', 'conversations', 'route.ts');
const linkPath = join(process.cwd(), 'app', 'api', 'conversations', 'link', 'route.ts');
const resolvePath = join(process.cwd(), 'app', 'api', 'conversations', 'resolve', 'route.ts');

test('POST /api/conversations: requires auth, site_id, and exactly one of primary_call_id or primary_session_id', () => {
  const src = readFileSync(createPath, 'utf8');
  assert.ok(src.includes('getUser()'), 'create checks auth');
  assert.ok(src.includes('validateSiteAccess'), 'create validates site access');
  assert.ok(src.includes('primary_call_id') && src.includes('primary_session_id'), 'create accepts primary entity');
  assert.ok(src.includes('Exactly one of'), 'create enforces exactly one primary');
});

test('POST /api/conversations/link: entity_type restricted to session, call, event', () => {
  const src = readFileSync(linkPath, 'utf8');
  assert.ok(src.includes("'session'") && src.includes("'call'") && src.includes("'event'"), 'link allows session|call|event');
  assert.ok(!src.includes("'intent'"), 'link does not allow intent this sprint');
});

test('POST /api/conversations/link: resolves entity by type and site_id, returns 400 ENTITY_SITE_MISMATCH when missing or wrong site', () => {
  const src = readFileSync(linkPath, 'utf8');
  assert.ok(src.includes('ENTITY_SITE_MISMATCH'), 'link returns 400 with code ENTITY_SITE_MISMATCH');
  assert.ok(src.includes("from('calls')") || src.includes('.from(\'calls\')'), 'link resolves call from calls table');
  assert.ok(src.includes("from('sessions')") || src.includes('.from(\'sessions\')'), 'link resolves session from sessions table');
  assert.ok(src.includes("from('events')") || src.includes('.from(\'events\')'), 'link resolves event from events table');
  assert.ok(src.includes('site_id') && src.includes('siteId'), 'link checks entity site_id matches conversation site');
});

test('POST /api/conversations/resolve: requires conversation_id and status WON|LOST|JUNK', () => {
  const src = readFileSync(resolvePath, 'utf8');
  assert.ok(src.includes('conversation_id') && src.includes('status'), 'resolve requires conversation_id and status');
  assert.ok(src.includes('WON') && src.includes('LOST') && src.includes('JUNK'), 'resolve accepts WON|LOST|JUNK');
  assert.ok(src.includes('validateSiteAccess'), 'resolve validates site access');
});
