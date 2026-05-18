import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

test('PR-7F sweep route is schema-compatible when calls.currency is absent', () => {
  const route = readFileSync(join(ROOT, 'app', 'api', 'cron', 'sweep-unsent-conversions', 'route.ts'), 'utf8');
  assert.ok(!route.includes("select('id, site_id, status, oci_status, confirmed_at, sale_amount, currency, lead_score')"));
  assert.ok(route.includes("select('id, site_id, status, oci_status, confirmed_at, sale_amount, sale_currency, lead_score')"));
  assert.ok(route.includes('currency: normalizeCurrencyOrNeutral(call.sale_currency ?? null)'));
});

test('PR-7F canonical enqueue path remains unchanged (name + external_id)', () => {
  const enqueue = readFileSync(join(ROOT, 'lib', 'oci', 'enqueue-seal-conversion.ts'), 'utf8');
  assert.ok(enqueue.includes('action: OPSMANTIK_CONVERSION_NAMES.won'));
  assert.ok(enqueue.includes('computeOfflineConversionExternalId'));
});

test('PR-7F keeps PR-7C guarded canonical repair flow', () => {
  const script = readFileSync(join(ROOT, 'scripts', 'db', 'repair-orphan-won-queue.mjs'), 'utf8');
  assert.ok(script.includes("/api/cron/sweep-unsent-conversions"));
  assert.ok(script.includes('TARGET_SITE_ID is required'));
  assert.ok(script.includes('CONFIRM_ORPHAN_WON_REPAIR must equal I_UNDERSTAND'));
});

test('PR-7F introduces no queue deletion or direct value math writes in sweep route', () => {
  const route = readFileSync(join(ROOT, 'app', 'api', 'cron', 'sweep-unsent-conversions', 'route.ts'), 'utf8');
  assert.ok(!/delete\s+from\s+offline_conversion_queue/i.test(route));
  assert.ok(!/value_cents\s*=/.test(route));
  assert.ok(!route.includes('COMPLETED'));
});

test('PR-7F repair-enqueue-won-calls uses sale_currency not calls.currency', () => {
  const repair = readFileSync(join(ROOT, 'scripts', 'oci', 'repair-enqueue-won-calls.ts'), 'utf8');
  assert.ok(!repair.includes('sale_amount, currency, lead_score'));
  assert.ok(repair.includes('sale_amount, sale_currency, lead_score'));
  assert.ok(repair.includes('normalizeCurrencyOrNeutral(c.sale_currency'));
});

test('PR-7F dry-run candidate discovery contract remains stable', () => {
  const sql = readFileSync(join(ROOT, 'scripts', 'sql', 'orphan_won_backfill.sql'), 'utf8');
  assert.ok(sql.includes('BLOCKED_MISSING_CLICK_ID'));
  assert.ok(sql.includes('CONSENT_MISSING'));
  assert.ok(sql.includes('ENQUEUEABLE'));
  assert.ok(sql.includes("'currency', c.currency"));
});
