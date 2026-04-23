#!/usr/bin/env node
/**
 * CI verify: DB RPCs + drift guards.
 *
 * Produces a JSON report at: ci-reports/db-verify.json
 * Exits non-zero if any required checks fail.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const outDir = join(process.cwd(), 'ci-reports');
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, 'db-verify.json');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || (!serviceKey && !anonKey)) {
  const msg =
    'Missing env. Provide NEXT_PUBLIC_SUPABASE_URL and either SUPABASE_SERVICE_ROLE_KEY (preferred) or NEXT_PUBLIC_SUPABASE_ANON_KEY.';
  console.error(msg);
  writeFileSync(outPath, JSON.stringify({ ok: false, error: msg }, null, 2));
  process.exit(1);
}

const key = serviceKey || anonKey;
const supabase = createClient(url, key, { auth: { persistSession: false } });
const { data: sampleSiteRow } = await supabase
  .from('sites')
  .select('id')
  .limit(1)
  .maybeSingle();
const sampleSiteId = sampleSiteRow?.id || '00000000-0000-0000-0000-000000000000';

const checks = [
  { name: 'ping', args: {} },
  { name: 'verify_partition_triggers_exist', args: {} },
  { name: 'verify_current_events_partition_exists', args: {}, optional: true },
  { name: 'watchtower_partition_drift_check_v1', args: {} },
  // Existing required RPCs
  { name: 'get_recent_intents_v1', args: { p_site_id: sampleSiteId } },
  { name: 'get_session_details', args: { p_site_id: sampleSiteId, p_session_id: '00000000-0000-0000-0000-000000000000' } },
  { name: 'get_session_timeline', args: { p_site_id: sampleSiteId, p_session_id: '00000000-0000-0000-0000-000000000000' } },
  { name: 'is_ads_session', args: {} },
  // New hardening RPCs
  { name: 'verify_call_event_signature_v1', args: { p_site_public_id: '0'.repeat(32), p_ts: 1, p_raw_body: '{}', p_signature: '0'.repeat(64) } },
  { name: 'resolve_site_identifier_v1', args: { p_input: '0'.repeat(32) } },
  { name: 'rotate_site_secret_v1', args: { p_site_public_id: '0'.repeat(32), p_current_secret: 'x'.repeat(32), p_next_secret: null }, serviceRoleOnly: true },
  { name: 'get_recent_intents_lite_v1', args: { p_site_id: sampleSiteId, p_date_from: '1970-01-01T00:00:00.000Z', p_date_to: '1970-01-02T00:00:00.000Z', p_limit: 1, p_ads_only: false } },
  { name: 'increment_usage_checked', args: { p_site_id: sampleSiteId, p_month: '1970-01-01', p_kind: 'revenue_events', p_limit: 1000 } },
  { name: 'decrement_and_delete_idempotency', args: { p_site_id: sampleSiteId, p_month: '1970-01-01', p_idempotency_key: 'verify-db', p_kind: 'revenue_events' } },
];

const tableChecks = [
  'site_plans',
  'site_usage_monthly',
  'usage_counters',
  'call_funnel_ledger',
  'marketing_signals',
  'offline_conversion_queue',
];

const columnChecks = [
  { name: 'calls_clickid_geo_columns', table: 'calls', select: 'id,location_source,click_id,gclid,wbraid,gbraid' },
  { name: 'sessions_geo_decision_columns', table: 'sessions', select: 'id,geo_source,geo_city,geo_district,geo_reason_code,geo_confidence' },
];

function isMissingFunctionError(error) {
  const msg = String(error?.message || '');
  return error?.code === 'PGRST116' || error?.code === 'PGRST202' || /not found|does not exist|404/i.test(msg);
}

const results = [];
for (const c of checks) {
  if (c.serviceRoleOnly && !serviceKey) {
    results.push({ name: c.name, ok: false, skipped: true, reason: 'service_role_key_missing' });
    continue;
  }

  // eslint-disable-next-line no-await-in-loop
  const { data, error } = await supabase.rpc(c.name, c.args);
  if (error) {
    results.push({
      name: c.name,
      ok: c.optional && isMissingFunctionError(error) ? true : false,
      missing: isMissingFunctionError(error),
      optional: Boolean(c.optional),
      error: { message: error.message, code: error.code },
    });
    continue;
  }
  results.push({ name: c.name, ok: true, sample: data });
}

for (const table of tableChecks) {
  // eslint-disable-next-line no-await-in-loop
  const { error } = await supabase
    .from(table)
    .select('*', { head: true, count: 'exact' })
    .limit(1);
  if (error) {
    const msg = String(error?.message || '');
    results.push({
      name: `table:${table}`,
      ok: false,
      missing: /does not exist|not found|relation/i.test(msg) || error?.code === '42P01',
      error: { message: error.message, code: error.code },
    });
    continue;
  }
  results.push({ name: `table:${table}`, ok: true });
}

for (const check of columnChecks) {
  // eslint-disable-next-line no-await-in-loop
  const { error } = await supabase
    .from(check.table)
    .select(check.select)
    .limit(1);
  if (error) {
    const msg = String(error?.message || '');
    results.push({
      name: `columns:${check.name}`,
      ok: false,
      missing: /does not exist|not found|relation|column/i.test(msg) || error?.code === '42703' || error?.code === '42P01',
      error: { message: error.message, code: error.code },
    });
    continue;
  }
  results.push({ name: `columns:${check.name}`, ok: true });
}

const missing = results.filter(r => r.ok === false && r.missing);
const failed = results.filter(r => r.ok === false && !r.skipped);
const ok = failed.length === 0;

const report = {
  ok,
  url,
  used_key: serviceKey ? 'service_role' : 'anon',
  missing_count: missing.length,
  failed_count: failed.length,
  results,
};

writeFileSync(outPath, JSON.stringify(report, null, 2));

if (!ok) {
  console.error(`DB verify failed. Missing=${missing.length} Failed=${failed.length}. Report: ${outPath}`);
  process.exit(1);
}

console.log(`DB verify OK. Report: ${outPath}`);

