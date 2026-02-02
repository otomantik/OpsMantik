/**
 * P4-1 Breakdown v1 smoke: get_dashboard_breakdown_v1 RPC.
 * Calls RPC twice: ads_only=true and ads_only=false.
 * Env: SITE_ID (or TEST_SITE_ID), optional P4_FROM, P4_TO (ISO); else first site + last 7 days.
 * Usage: node scripts/smoke/p4-breakdown-proof.mjs
 */
import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const siteIdEnv = process.env.SITE_ID || process.env.TEST_SITE_ID;
const fromEnv = process.env.P4_FROM;
const toEnv = process.env.P4_TO;

const OUT_DIR = path.join(process.cwd(), 'docs', '_archive', '2026-02-02', 'WAR_ROOM', 'EVIDENCE', 'P4_BREAKDOWN');

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function checkDataset(data, total, datasetName) {
  const arr = data[datasetName];
  assert(Array.isArray(arr), `${datasetName} must be array`);
  let sumCount = 0;
  for (const item of arr) {
    assert(item != null && typeof item === 'object', `${datasetName} item must be object`);
    assert('name' in item && typeof item.count === 'number' && typeof item.pct === 'number', `${datasetName} item must have name, count, pct`);
    assert(item.pct >= 0 && item.pct <= 100, `pct must be in [0,100], got ${item.pct}`);
    sumCount += item.count;
  }
  assert(sumCount <= total + 1, `sum(counts) for ${datasetName} (${sumCount}) should be <= total (${total}) + tolerance`);
  if (total > 0 && datasetName === 'devices') {
    assert(sumCount > 0, 'if total_sessions>0 then devices sum must be > 0');
  }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  let siteId = siteIdEnv;
  if (!siteId) {
    const { data: sites, error } = await supabase.from('sites').select('id').limit(1);
    if (error) throw new Error('Failed to fetch site: ' + error.message);
    if (!sites?.length) throw new Error('No sites in DB');
    siteId = sites[0].id;
  }

  const dateTo = toEnv ? new Date(toEnv) : new Date();
  const dateFrom = fromEnv ? new Date(fromEnv) : (() => { const d = new Date(); d.setDate(d.getDate() - 7); return d; })();

  const fromIso = dateFrom.toISOString();
  const toIso = dateTo.toISOString();

  // Call 1: ads_only=true
  const { data: dataAds, error: errAds } = await supabase.rpc('get_dashboard_breakdown_v1', {
    p_site_id: siteId,
    p_date_from: fromIso,
    p_date_to: toIso,
    p_ads_only: true,
  });
  if (errAds) throw new Error('RPC ads_only=true: ' + errAds.message);
  assert(dataAds != null && typeof dataAds === 'object', 'RPC must return object');
  assert(Number.isInteger(dataAds.total_sessions) && dataAds.total_sessions >= 0, 'total_sessions must be non-negative integer');
  checkDataset(dataAds, dataAds.total_sessions, 'sources');
  checkDataset(dataAds, dataAds.total_sessions, 'locations');
  checkDataset(dataAds, dataAds.total_sessions, 'devices');

  // Call 2: ads_only=false
  const { data: dataAll, error: errAll } = await supabase.rpc('get_dashboard_breakdown_v1', {
    p_site_id: siteId,
    p_date_from: fromIso,
    p_date_to: toIso,
    p_ads_only: false,
  });
  if (errAll) throw new Error('RPC ads_only=false: ' + errAll.message);
  assert(dataAll != null && typeof dataAll === 'object', 'RPC must return object');
  assert(Number.isInteger(dataAll.total_sessions) && dataAll.total_sessions >= 0, 'total_sessions must be non-negative integer');
  checkDataset(dataAll, dataAll.total_sessions, 'sources');
  checkDataset(dataAll, dataAll.total_sessions, 'locations');
  checkDataset(dataAll, dataAll.total_sessions, 'devices');

  // Summary
  console.log('P4-1 Breakdown v1 smoke: PASS');
  console.log('ads_only=true  -> total_sessions:', dataAds.total_sessions, '| sources:', dataAds.sources?.length ?? 0, '| locations:', dataAds.locations?.length ?? 0, '| devices:', dataAds.devices?.length ?? 0);
  console.log('ads_only=false -> total_sessions:', dataAll.total_sessions, '| sources:', dataAll.sources?.length ?? 0, '| locations:', dataAll.locations?.length ?? 0, '| devices:', dataAll.devices?.length ?? 0);

  const proof = JSON.stringify({ ads_only_true: dataAds, ads_only_false: dataAll }, null, 2);
  fs.writeFileSync(path.join(OUT_DIR, 'rpc_result_v1.json'), proof);
  fs.writeFileSync(path.join(OUT_DIR, 'smoke_log.txt'), `PASS\nsite_id=${siteId}\nads_only=true total=${dataAds.total_sessions}\nads_only=false total=${dataAll.total_sessions}\n`);
  console.log('Evidence:', path.join(OUT_DIR, 'rpc_result_v1.json'));
}

main().catch((err) => {
  console.error('P4-1 Breakdown v1 smoke: FAIL', err.message);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'smoke_log.txt'), `FAIL: ${err.message}\n`);
  process.exit(1);
});
