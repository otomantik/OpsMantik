/**
 * Sales API: contract/source tests (no Next request context).
 * Auth and body validation are asserted via source inspection.
 * Integration: cross-tenant 404/403 and confirm idempotency (409, queue count 1) require DB.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const salesRoutePath = join(process.cwd(), 'app', 'api', 'sales', 'route.ts');
const confirmRoutePath = join(process.cwd(), 'app', 'api', 'sales', 'confirm', 'route.ts');

test('GET /api/sales: route requires auth and site_id', () => {
  const src = readFileSync(salesRoutePath, 'utf8');
  assert.ok(src.includes('getUser()'), 'GET checks auth');
  assert.ok(src.includes('site_id') && src.includes('searchParams.get'), 'GET requires site_id query');
  assert.ok(src.includes('validateSiteAccess'), 'GET validates site access');
});

test('POST /api/sales: route requires auth, site_id, occurred_at, amount', () => {
  const src = readFileSync(salesRoutePath, 'utf8');
  assert.ok(src.includes('getUser()'), 'POST checks auth');
  assert.ok(src.includes('validateSiteAccess'), 'POST validates site access');
  assert.ok(src.includes('occurred_at') && src.includes('amount'), 'POST validates body');
});

test('POST /api/sales: conversation_id must belong to the same site', () => {
  const src = readFileSync(salesRoutePath, 'utf8');
  assert.ok(src.includes('validateConversationSite'), 'POST validates conversation ownership');
  assert.ok(src.includes("code: 'CONVERSATION_SITE_MISMATCH'"), 'POST returns deterministic mismatch code');
  assert.ok(src.includes(".from('conversations')"), 'POST resolves conversation row before write');
});

test('POST /api/sales: external_ref replay cannot mutate finalized sales and updates full draft identity set', () => {
  const src = readFileSync(salesRoutePath, 'utf8');
  assert.ok(src.includes("existing.status !== 'DRAFT'"), 'finalized sales must reject external_ref replay mutation');
  assert.ok(src.includes("code: 'SALE_FINALIZED_IMMUTABLE'"), 'route returns deterministic finalized-sale code');
  assert.ok(src.includes('currency: payload.currency'), 'draft update path must refresh currency');
  assert.ok(src.includes('customer_hash: payload.customerHash'), 'draft update path must refresh customer_hash');
});

test('POST /api/sales/confirm accepts only sale_id and derives scope from sale row', () => {
  const src = readFileSync(confirmRoutePath, 'utf8');
  assert.ok(src.includes('sale_id'), 'confirm accepts sale_id');
  assert.ok(src.includes('sale.site_id'), 'confirm uses sale.site_id from fetched row for validateSiteAccess');
  assert.ok(src.includes('confirm_sale_and_enqueue'), 'confirm calls only RPC');
});

test('POST /api/sales/confirm maps RPC errors to 409 and 404', () => {
  const src = readFileSync(confirmRoutePath, 'utf8');
  assert.ok(src.includes('sale_already_confirmed_or_canceled') || src.includes('409'), 'confirm maps already-confirmed to 409');
  assert.ok(src.includes('sale_not_found') || src.includes('404'), 'confirm maps not-found to 404');
});

test('Idempotency: RPC confirm_sale_and_enqueue rejects non-DRAFT (second call => 409)', () => {
  const migrationPath = join(process.cwd(), 'supabase', 'migrations', '20260218000000_conversation_layer_tables.sql');
  const src = readFileSync(migrationPath, 'utf8');
  assert.ok(
    src.includes("v_sale.status IS DISTINCT FROM 'DRAFT'") || src.includes("status IS DISTINCT FROM 'DRAFT'"),
    'RPC must check status and raise for already CONFIRMED/CANCELED'
  );
  assert.ok(
    src.includes('sale_already_confirmed_or_canceled'),
    'RPC must raise sale_already_confirmed_or_canceled for idempotency'
  );
  assert.ok(
    src.includes('ON CONFLICT (sale_id) DO NOTHING') || src.includes('ON CONFLICT ON CONSTRAINT offline_conversion_queue_sale_id_key DO NOTHING'),
    'queue insert must be idempotent (ON CONFLICT DO NOTHING)'
  );
});

test('sales kernel: DB trigger rejects cross-site conversation_id on sale writes', () => {
  const migrationPath = join(process.cwd(), 'supabase', 'migrations', '20261105110000_sales_conversation_site_guard.sql');
  const src = readFileSync(migrationPath, 'utf8');
  assert.ok(src.includes('sales_conversation_site_check'), 'migration defines sales site guard function');
  assert.ok(src.includes('c.id = NEW.conversation_id') && src.includes('c.site_id = NEW.site_id'), 'trigger enforces same-site conversation lookup');
  assert.ok(src.includes('sales_conversation_site_trigger'), 'migration installs trigger on sales');
});

test('sales kernel: finalized monetary identity fields are immutable', () => {
  const migrationPath = join(process.cwd(), 'supabase', 'migrations', '20261105120000_conversation_resolve_and_sales_replay_hardening.sql');
  const src = readFileSync(migrationPath, 'utf8');
  assert.ok(src.includes('sales_finalized_identity_immutable_check'), 'migration defines finalized sale immutability trigger');
  assert.ok(src.includes('finalized identity fields are immutable'), 'trigger raises deterministic finalized-sale message');
  assert.ok(src.includes('OLD.status IS DISTINCT FROM \'DRAFT\''), 'trigger protects non-DRAFT sales');
});
