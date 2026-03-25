/**
 * Conversation API: contract/source tests (no Next request context).
 * Auth and body validation asserted via source inspection.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const createPath = join(process.cwd(), 'app', 'api', 'conversations', 'route.ts');
const detailPath = join(process.cwd(), 'app', 'api', 'conversations', '[id]', 'route.ts');
const linkPath = join(process.cwd(), 'app', 'api', 'conversations', 'link', 'route.ts');
const helperPath = join(process.cwd(), 'lib', 'api', 'conversations', 'http.ts');
const resolvePath = join(process.cwd(), 'app', 'api', 'conversations', 'resolve', 'route.ts');
const assignPath = join(process.cwd(), 'app', 'api', 'conversations', 'assign', 'route.ts');
const followUpPath = join(process.cwd(), 'app', 'api', 'conversations', 'follow-up', 'route.ts');
const notePath = join(process.cwd(), 'app', 'api', 'conversations', 'note', 'route.ts');
const stagePath = join(process.cwd(), 'app', 'api', 'conversations', 'stage', 'route.ts');
const reopenPath = join(process.cwd(), 'app', 'api', 'conversations', 'reopen', 'route.ts');

test('POST /api/conversations: requires auth, site_id, and exactly one of primary_call_id or primary_session_id', () => {
  const src = readFileSync(createPath, 'utf8');
  assert.ok(src.includes('getUser()'), 'create checks auth');
  assert.ok(src.includes('validateSiteAccess'), 'create validates site access');
  assert.ok(src.includes('primary_call_id') && src.includes('primary_session_id'), 'create accepts primary entity');
  assert.ok(src.includes('Exactly one of'), 'create enforces exactly one primary');
});

test('POST /api/conversations: uses atomic RPC and deterministic site mismatch code', () => {
  const src = readFileSync(createPath, 'utf8');
  assert.ok(src.includes("rpc('create_conversation_with_primary_entity'"), 'create route uses atomic create RPC');
  assert.ok(src.includes("code: 'PRIMARY_ENTITY_SITE_MISMATCH'"), 'create route returns deterministic mismatch code');
  assert.ok(!src.includes(".from('conversation_links').insert"), 'create route should not insert link in app layer');
});

test('GET /api/conversations: validates site_id and uses inbox RPC', () => {
  const src = readFileSync(createPath, 'utf8');
  assert.ok(src.includes('export async function GET'), 'conversations route exposes GET');
  assert.ok(src.includes('validateSiteAccess'), 'GET validates site access');
  assert.ok(src.includes("rpc('get_conversation_inbox_v1'"), 'GET delegates to inbox RPC');
});

test('GET /api/conversations/[id]: uses detail RPC', () => {
  const src = readFileSync(detailPath, 'utf8');
  assert.ok(src.includes("rpc('get_conversation_detail_v1'"), 'detail route delegates to detail RPC');
  assert.ok(src.includes('conversation id must be a valid UUID'), 'detail route validates conversation id');
});

test('POST /api/conversations/link: entity_type restricted to session, call, event', () => {
  const src = readFileSync(linkPath, 'utf8');
  assert.ok(src.includes("'session'") && src.includes("'call'") && src.includes("'event'"), 'link allows session|call|event');
  assert.ok(!src.includes("'intent'"), 'link does not allow intent this sprint');
});

test('POST /api/conversations/link: resolves entity by type and site_id, returns 400 ENTITY_SITE_MISMATCH when missing or wrong site', () => {
  const src = readFileSync(linkPath, 'utf8');
  const helperSrc = readFileSync(helperPath, 'utf8');
  assert.ok(helperSrc.includes('ENTITY_SITE_MISMATCH'), 'link returns 400 with code ENTITY_SITE_MISMATCH');
  assert.ok(src.includes("rpc('conversation_link_entity_v1'"), 'link delegates to kernel RPC');
  assert.ok(!src.includes(".from('conversation_links').insert"), 'link route should not write conversation_links directly');
});

test('POST /api/conversations/resolve: requires conversation_id and status WON|LOST|JUNK', () => {
  const src = readFileSync(resolvePath, 'utf8');
  assert.ok(src.includes('conversation_id') && src.includes('status'), 'resolve requires conversation_id and status');
  assert.ok(src.includes('WON') && src.includes('LOST') && src.includes('JUNK'), 'resolve accepts WON|LOST|JUNK');
  assert.ok(src.includes("rpc('resolve_conversation_with_sale_link'"), 'resolve must delegate to atomic RPC');
  assert.ok(src.includes("code: 'IMMUTABLE_AFTER_SENT'"), 'resolve surfaces immutable queue conflicts deterministically');
  assert.ok(src.includes("code: 'SALE_ALREADY_LINKED_ELSEWHERE'"), 'resolve surfaces sale link conflicts deterministically');
});

test('conversation kernel: create RPC is atomic and trigger validates primary entity site match', () => {
  const migrationPath = join(process.cwd(), 'supabase', 'migrations', '20261105113000_conversation_create_atomic.sql');
  const src = readFileSync(migrationPath, 'utf8');
  assert.ok(src.includes('conversations_primary_entity_site_check'), 'migration defines primary entity site guard');
  assert.ok(src.includes('create_conversation_with_primary_entity'), 'migration defines atomic create RPC');
  assert.ok(src.includes("INSERT INTO public.conversations") && src.includes("INSERT INTO public.conversation_links"), 'RPC creates conversation and first link in one DB function');
  assert.ok(src.includes('primary_entity_site_mismatch'), 'RPC fails closed on wrong-site primary entity');
});

test('conversation kernel: resolve RPC is atomic and validates sale linkability before commit', () => {
  const migrationPath = join(process.cwd(), 'supabase', 'migrations', '20261105120000_conversation_resolve_and_sales_replay_hardening.sql');
  const src = readFileSync(migrationPath, 'utf8');
  assert.ok(src.includes('resolve_conversation_with_sale_link'), 'migration defines atomic resolve RPC');
  assert.ok(src.includes('sale_already_linked_elsewhere'), 'RPC rejects already-linked sales');
  assert.ok(src.includes('sale_site_mismatch'), 'RPC rejects wrong-site sales');
  assert.ok(src.includes('update_offline_conversion_queue_attribution'), 'RPC backfills queue attribution inside the same transaction');
});

test('conversation phase2 kernel: inbox/detail/mutation RPCs are defined in one migration', () => {
  const migrationPath = join(process.cwd(), 'supabase', 'migrations', '20261201010000_conversation_crm_phase2_kernel.sql');
  const src = readFileSync(migrationPath, 'utf8');
  assert.ok(src.includes('get_conversation_inbox_v1'), 'phase2 defines inbox RPC');
  assert.ok(src.includes('get_conversation_detail_v1'), 'phase2 defines detail RPC');
  assert.ok(src.includes('conversation_assign_v1'), 'phase2 defines assign RPC');
  assert.ok(src.includes('conversation_set_follow_up_v1'), 'phase2 defines follow-up RPC');
  assert.ok(src.includes('conversation_add_note_v1'), 'phase2 defines note RPC');
  assert.ok(src.includes('conversation_change_stage_v1'), 'phase2 defines stage RPC');
  assert.ok(src.includes('conversation_reopen_v1'), 'phase2 defines reopen RPC');
  assert.ok(src.includes('conversation_link_entity_v1'), 'phase2 defines link RPC');
});

test('conversation mutation routes are thin wrappers over RPCs', () => {
  const assignSrc = readFileSync(assignPath, 'utf8');
  const followUpSrc = readFileSync(followUpPath, 'utf8');
  const noteSrc = readFileSync(notePath, 'utf8');
  const stageSrc = readFileSync(stagePath, 'utf8');
  const reopenSrc = readFileSync(reopenPath, 'utf8');

  assert.ok(assignSrc.includes("rpc('conversation_assign_v1'"), 'assign route uses assign RPC');
  assert.ok(followUpSrc.includes("rpc('conversation_set_follow_up_v1'"), 'follow-up route uses follow-up RPC');
  assert.ok(noteSrc.includes("rpc('conversation_add_note_v1'"), 'note route uses note RPC');
  assert.ok(stageSrc.includes("rpc('conversation_change_stage_v1'"), 'stage route uses stage RPC');
  assert.ok(reopenSrc.includes("rpc('conversation_reopen_v1'"), 'reopen route uses reopen RPC');
});
