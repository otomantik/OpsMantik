#!/usr/bin/env node
/**
 * PR-9H.5B — Read-only offline_conversion_queue coverage audit for a single site.
 * Resolves public_id vs sites.id before any queue query (PR-9H.5B.0A).
 *
 * Usage:
 *   TARGET_SITE_ID=<public_id_or_uuid> PROVIDER_KEY=google_ads OUTPUT_JSON=1 node scripts/db/pr9h5b-queue-coverage-audit.mjs
 *
 * Does not mutate DB. Does not print raw gclid / wbraid / gbraid (aggregates only).
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveSiteIdentity, SITE_NOT_FOUND_HINT } from './lib/resolve-site-identity.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '..', '.env.local'), override: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const rawTarget = process.env.TARGET_SITE_ID || process.env.OPSMANTIK_SITE_ID || '';
const providerKey = String(process.env.PROVIDER_KEY || 'google_ads').trim() || 'google_ads';
const outputJson = process.env.OUTPUT_JSON === '1' || process.env.OUTPUT_JSON === 'true';

if (!url || !key) {
  const err = { ok: false, code: 'ENV_MISSING', detail: 'NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' };
  console.error(outputJson ? JSON.stringify(err, null, 2) : err.detail);
  process.exit(1);
}

const adminClient = createClient(url, key);

let resolved;
try {
  resolved = await resolveSiteIdentity(adminClient, rawTarget);
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  const err = { ok: false, code: 'RESOLVE_ERROR', detail: msg };
  console.error(outputJson ? JSON.stringify(err, null, 2) : msg);
  process.exit(1);
}

if (!resolved.found) {
  const err = {
    ok: false,
    code: 'SITE_NOT_FOUND',
    input_site_identifier: resolved.input || rawTarget,
    hint: SITE_NOT_FOUND_HINT,
  };
  console.error(outputJson ? JSON.stringify(err, null, 2) : `${err.code}\n${err.hint}`);
  process.exit(1);
}

const siteUuid = resolved.siteUuid;

/** All queue queries MUST use resolved UUID — never raw env against site_id */

function tallyStatus(rows) {
  const m = new Map();
  for (const r of rows) {
    const k = r.status ?? '(null)';
    m.set(k, (m.get(k) || 0) + 1);
  }
  return Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]));
}

function tallyActionStatus(rows) {
  const m = new Map();
  for (const r of rows) {
    const a = r.action ?? '(null)';
    const s = r.status ?? '(null)';
    const k = `${a}||${s}`;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()]
    .map(([k, cnt]) => {
      const [action, status] = k.split('||');
      return { action, status, count: cnt };
    })
    .sort((x, y) => y.count - x.count);
}

function tallyFailedCodes(rows) {
  const m = new Map();
  for (const r of rows) {
    if (r.status !== 'FAILED') continue;
    const c = r.provider_error_code ?? '(null)';
    const cat = r.provider_error_category ?? '(null)';
    const k = `${c}||${cat}`;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()]
    .map(([k, cnt]) => {
      const [provider_error_code, provider_error_category] = k.split('||');
      return { provider_error_code, provider_error_category, count: cnt };
    })
    .sort((x, y) => y.count - x.count);
}

function hasClickPart(v) {
  return v != null && String(v).trim() !== '';
}

function tallyClickBooleans(rows, statusFilter) {
  const m = new Map();
  for (const r of rows) {
    if (statusFilter && !statusFilter.includes(r.status)) continue;
    const g = hasClickPart(r.gclid);
    const w = hasClickPart(r.wbraid);
    const b = hasClickPart(r.gbraid);
    const k = `${g}|${w}|${b}`;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].map(([k, cnt]) => {
    const [has_gclid, has_wbraid, has_gbraid] = k.split('|').map((x) => x === 'true');
    return { has_gclid, has_wbraid, has_gbraid, count: cnt };
  });
}

function tallyCurrencyStatus(rows) {
  const m = new Map();
  for (const r of rows) {
    const c = r.currency?.trim() || '(null)';
    const s = r.status ?? '(null)';
    const k = `${c}||${s}`;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()]
    .map(([k, cnt]) => {
      const [currency, status] = k.split('||');
      return { currency, status, count: cnt };
    })
    .sort((x, y) => y.count - x.count);
}

let report;
try {
  const { data: allRows, error: allErr } = await adminClient
    .from('offline_conversion_queue')
    .select(
      'status, action, provider_error_code, provider_error_category, currency, gclid, wbraid, gbraid, conversion_time'
    )
    .eq('site_id', siteUuid)
    .eq('provider_key', providerKey);

  if (allErr) throw new Error(allErr.message);

  const rows = Array.isArray(allRows) ? allRows : [];
  const exportEligible = rows.filter((r) => r.status === 'QUEUED' || r.status === 'RETRY');

  report = {
    ok: true,
    code: 'PR9H5B_QUEUE_COVERAGE',
    input_site_identifier: resolved.input,
    resolved_site_uuid: siteUuid,
    resolved_public_id: resolved.publicId,
    provider_key: providerKey,
    total_rows: rows.length,
    export_eligible_queued_retry: exportEligible.length,
    by_status: tallyStatus(rows),
    by_action_status: tallyActionStatus(rows),
    failed_by_error_code: tallyFailedCodes(rows),
    click_id_shape_queued_retry: tallyClickBooleans(rows, ['QUEUED', 'RETRY']),
    by_currency_status: tallyCurrencyStatus(rows),
  };
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  const err = { ok: false, code: 'QUERY_ERROR', detail: msg, input_site_identifier: resolved.input, resolved_site_uuid: siteUuid };
  console.error(outputJson ? JSON.stringify(err, null, 2) : msg);
  process.exit(1);
}

if (outputJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log('input_site_identifier:', report.input_site_identifier);
  console.log('resolved_site_uuid:   ', report.resolved_site_uuid);
  console.log('resolved_public_id:   ', report.resolved_public_id ?? '(null)');
  console.log('provider_key:         ', report.provider_key);
  console.log('total_rows:           ', report.total_rows);
  console.log('export_QUEUED_RETRY:  ', report.export_eligible_queued_retry);
  console.log('\nby_status:', JSON.stringify(report.by_status, null, 2));
  console.log('\nby_action_status:', JSON.stringify(report.by_action_status, null, 2));
  console.log('\nfailed_by_error_code:', JSON.stringify(report.failed_by_error_code, null, 2));
  console.log('\nclick_id_shape (QUEUED/RETRY, booleans only):', JSON.stringify(report.click_id_shape_queued_retry, null, 2));
  console.log('\nby_currency_status:', JSON.stringify(report.by_currency_status, null, 2));
}
