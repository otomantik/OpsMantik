#!/usr/bin/env node
/**
 * Non-zero workload proof for N+1 bulk refactored cron endpoints.
 * 1) Run SQL counts for eligible rows
 * 2) If zero, seed minimal test rows (--seed), then rerun crons
 * 3) Capture evidence
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET
 * Optional: SMOKE_BASE_URL (default https://console.opsmantik.com), PROOF_SITE_ID
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve } from 'path';
import { execSync } from 'child_process';

config({ path: resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const BASE = (process.env.SMOKE_BASE_URL ?? 'https://console.opsmantik.com').replace(/\/$/, '');
const PROOF_SITE_ID = process.env.PROOF_SITE_ID;

if (!supabaseUrl || !serviceKey || !CRON_SECRET) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or CRON_SECRET');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey);
const EVIDENCE = [];

function log(msg, obj = {}) {
  const line = obj && Object.keys(obj).length ? `${msg} ${JSON.stringify(obj)}` : msg;
  console.log(line);
  EVIDENCE.push(line);
}

function curl(name, method, path) {
  const url = `${BASE}${path}`;
  const safeSecret = CRON_SECRET.replace(/"/g, '\\"');
  const cmd = `curl.exe -s -w "\\n%{http_code}" -X ${method} -H "Authorization: Bearer ${safeSecret}" "${url}"`;
  try {
    const out = execSync(cmd, { encoding: 'utf8', timeout: 60000 }).trim();
    const parts = out.split('\n');
    const code = parts.pop() ?? '000';
    const body = parts.join('\n');
    const json = body ? (() => { try { return JSON.parse(body); } catch { return {}; } })() : {};
    log(`[${code}] ${name}`, { response: json });
    return { code, json };
  } catch (e) {
    log(`[ERR] ${name}`, { error: e.message });
    return { code: '000', json: {} };
  }
}

function getFreezeYearMonth() {
  const now = new Date();
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const y = prev.getUTCFullYear();
  const m = String(prev.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

async function runCounts() {
  const yearMonth = getFreezeYearMonth();
  log('--- SQL counts ---');
  log('Freeze year_month', { yearMonth });

  const counts = { oci: 0, freeze: 0, recover: 0 };

  const { count: ociCount, error: ociErr } = await supabase
    .from('offline_conversion_queue')
    .select('*', { count: 'exact', head: true })
    .in('status', ['QUEUED', 'RETRY'])
    .or('next_retry_at.is.null,next_retry_at.lte.' + new Date().toISOString());

  if (ociErr) log('offline_conversion_queue eligible', { error: ociErr.message });
  else {
    counts.oci = ociCount ?? 0;
    log('offline_conversion_queue eligible', { count: counts.oci });
  }

  const { count: freezeCount, error: freezeErr } = await supabase
    .from('site_usage_monthly')
    .select('*', { count: 'exact', head: true })
    .eq('year_month', yearMonth);

  if (freezeErr) log('site_usage_monthly (freeze month)', { error: freezeErr.message });
  else {
    counts.freeze = freezeCount ?? 0;
    log('site_usage_monthly (freeze month)', { count: counts.freeze });
  }

  const { count: recoverCount, error: recoverErr } = await supabase
    .from('ingest_fallback_buffer')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'PENDING');

  if (recoverErr) log('ingest_fallback_buffer PENDING', { error: recoverErr.message });
  else {
    counts.recover = recoverCount ?? 0;
    log('ingest_fallback_buffer PENDING', { count: counts.recover });
  }

  return counts;
}

async function seedOci(siteId) {
  const { data: sale, error: saleErr } = await supabase
    .from('sales')
    .insert({ site_id: siteId, occurred_at: new Date().toISOString(), amount_cents: 25000, currency: 'TRY', status: 'CONFIRMED' })
    .select('id, site_id')
    .single();

  if (saleErr || !sale) {
    log('Seed sale failed', { error: saleErr?.message });
    return false;
  }
  log('Seed sale inserted', { sale_id: sale.id });

  const { data: qRow, error: qErr } = await supabase
    .from('offline_conversion_queue')
    .insert({
      site_id: sale.site_id,
      sale_id: sale.id,
      provider_key: 'google_ads',
      gclid: 'TeSt_GCLID_NonZero_Proof_' + Date.now(),
      conversion_time: new Date().toISOString(),
      value_cents: 25000,
      currency: 'TRY',
      status: 'QUEUED',
      next_retry_at: new Date(Date.now() - 60000).toISOString(),
    })
    .select('id')
    .single();

  if (qErr) {
    log('Seed offline_conversion_queue failed', { error: qErr.message });
    return false;
  }
  log('Seed offline_conversion_queue inserted', { queue_id: qRow.id });
  return true;
}

async function seedFreeze(siteId) {
  const yearMonth = getFreezeYearMonth();
  const { error } = await supabase.from('site_usage_monthly').upsert(
    { site_id: siteId, year_month: yearMonth, event_count: 1, overage_count: 0 },
    { onConflict: 'site_id,year_month' }
  );
  if (error) {
    log('Seed site_usage_monthly failed', { error: error.message });
    return false;
  }
  log('Seed site_usage_monthly upserted', { site_id: siteId, year_month: yearMonth });
  return true;
}

async function getSeedSiteId() {
  if (PROOF_SITE_ID) {
    const { data } = await supabase.from('sites').select('id').eq('id', PROOF_SITE_ID).single();
    if (data) return data.id;
  }
  const { data: withCred } = await supabase
    .from('provider_credentials')
    .select('site_id')
    .eq('provider_key', 'google_ads')
    .eq('is_active', true)
    .limit(1)
    .single();
  if (withCred) return withCred.site_id;
  const { data: anySite } = await supabase.from('sites').select('id').limit(1).single();
  return anySite?.id;
}

async function main() {
  const doSeed = process.argv.includes('--seed');
  log('=== Non-zero workload proof ===');
  log('BASE', { url: BASE });
  log('Seed mode', { enabled: doSeed });

  let counts = await runCounts();

  if (doSeed) {
    const siteId = await getSeedSiteId();
    if (!siteId) {
      log('No site for seeding', {});
      process.exit(1);
    }
    log('Seed site_id', { site_id: siteId });
    if (counts.oci === 0) await seedOci(siteId);
    if (counts.freeze === 0) await seedFreeze(siteId);
    counts = await runCounts();
  }

  log('--- Cron runs ---');
  const r1 = curl('process-offline-conversions', 'POST', '/api/cron/process-offline-conversions?limit=10');
  const r2 = curl('invoice-freeze', 'POST', '/api/cron/invoice-freeze');
  const r3 = curl('recover', 'GET', '/api/cron/recover');

  const processed = r1.json?.processed ?? 0;
  const frozen = r2.json?.frozen ?? 0;
  const claimed = r3.json?.claimed ?? 0;

  log('--- Evidence summary ---');
  log('Bulk workload', {
    oci_eligible_before: counts.oci,
    freeze_rows_before: counts.freeze,
    recover_pending_before: counts.recover,
    processed_after: processed,
    frozen_after: frozen,
    claimed_after: claimed,
    non_zero: processed > 0 || frozen > 0 || claimed > 0,
  });

  const outPath = resolve(process.cwd(), 'docs/_evidence/cron-bulk-nonzero-proof.log');
  try {
    const fs = await import('fs');
    const dir = resolve(process.cwd(), 'docs/_evidence');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(outPath, EVIDENCE.join('\n'), 'utf8');
    log('Evidence written', { path: outPath });
  } catch (e) {
    log('Evidence write failed', { error: e.message });
  }

  console.log('\n--- PROOF OUTPUT ---');
  EVIDENCE.forEach((l) => console.log(l));
  process.exit(processed > 0 || frozen > 0 || claimed > 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
