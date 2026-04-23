#!/usr/bin/env node
/**
 * P0 Multi-Site Intent Test — selected domains sync -> events + calls (ingest worker path)
 *
 * DEPLOY GATE (KESİN EMİR): Bu test çalıştırılmadan deploy edilmeyecek.
 * Intent bizim belkemiğimiz. Aksi belirtilene kadar bu kesin bir emirdir.
 * docs/OPS/DEPLOY_GATE_INTENT.md
 *
 * Env:
 *   P0_SITES — Domain listesi (virgülle): yapiozmendanismanlik.com,sosreklam.com
 *   SYNC_API_URL — default https://console.opsmantik.com/api/sync
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Bu script DB’de sync worker’ın yazdığı `events` + `calls` satırlarını arar. SYNC_API_URL
 * (ör. https://console.opsmantik.com) hangi Supabase projesine yazıyorsa, .env.local
 * aynı projeyi hedeflemelidir; aksi halde 202 dönse bile sorgu boş kalır.
 *
 * Usage:
 *   P0_SITES="yapiozmendanismanlik.com,sosreklam.com" node scripts/smoke/p0_intent_multi_site.mjs
 *   node scripts/smoke/p0_intent_multi_site.mjs  # default 2 site
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, serviceKey);

const SYNC_API_URL = process.env.SYNC_API_URL || 'https://console.opsmantik.com/api/sync';
const ORIGIN = process.env.ORIGIN || 'https://www.yapiozmendanismanlik.com';
const DEFAULT_SITES = 'yapiozmendanismanlik.com,sosreklam.com';
const SITES_RAW = process.env.P0_SITES || DEFAULT_SITES;
const SITES = SITES_RAW.split(',').map((s) => s.trim()).filter(Boolean);

const dbRetries = parseInt(process.env.P0_DB_RETRIES || '12', 10);
const dbRetryMs = parseInt(process.env.P0_DB_RETRY_MS || '2000', 10);

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function retry(label, fn, attempts = dbRetries, baseMs = dbRetryMs) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      console.warn(`⚠️  ${label} retry ${i}/${attempts}:`, e?.message || e);
      await sleep(baseMs * i);
    }
  }
  throw last;
}

async function findSiteByDomain(domain) {
  const d = domain.replace(/^https?:\/\//, '').replace(/\/$/, '').split('/')[0].toLowerCase();
  const { data, error } = await supabase
    .from('sites')
    .select('id, public_id, domain')
    .ilike('domain', `%${d}%`)
    .limit(10);
  if (error) throw error;
  const row = (data || []).find((r) => {
    const dom = (r.domain || '').toLowerCase();
    return dom.includes(d) || dom.replace('www.', '') === d || dom === 'www.' + d;
  }) || data?.[0];
  if (!row?.public_id) return null;
  return { site_id: row.id, site_public_id: row.public_id, domain: row.domain || domain };
}

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
/** Lookback for DB polling (clocks, queue latency). */
const WINDOW_MS = parseInt(process.env.P0_SMOKE_LOOKBACK_MS || '120000', 10);

async function runTestForSite(siteInfo) {
  const { site_id: internalSiteId, site_public_id, domain } = siteInfo;
  const sid = generateUUID();
  const t0 = new Date(Date.now() - WINDOW_MS);

  const payload = {
    s: site_public_id,
    u: `https://${domain}/test-landing?gclid=TEST_MULTISITE`,
    sid,
    ec: 'conversion',
    ea: 'phone_call',
    el: 'tel:+905000000000',
    ev: null,
    r: 'https://google.com/',
    meta: { fp: 'fp_multi_test', gclid: 'TEST' },
    consent_scopes: ['analytics', 'marketing'],
  };

  const res = await fetch(SYNC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: ORIGIN,
      'User-Agent': BROWSER_UA,
    },
    body: JSON.stringify(payload),
  });

  const rawText = await res.text().catch(() => '');
  if (!res.ok) {
    throw new Error(`sync_http_${res.status}: ${rawText.slice(0, 300)}`);
  }
  let body = {};
  try {
    body = rawText ? JSON.parse(rawText) : {};
  } catch {
    throw new Error(`sync_not_json: status=${res.status} body=${rawText.slice(0, 200)}`);
  }
  if (!body?.ok) {
    const hint = res.status === 204 ? ' (204 No Content — consent_scopes veya payload kontrol et)' : '';
    throw new Error(`sync_not_ok: ${JSON.stringify(body)}${hint}`);
  }

  const eventRow = await retry(`DB events [${domain}]`, async () => {
    const { data, error } = await supabase
      .from('events')
      .select('id, event_action, event_category, created_at')
      .eq('site_id', internalSiteId)
      .eq('event_action', 'phone_call')
      .gte('created_at', t0.toISOString())
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) throw error;
    if (!data?.[0]) {
      const { data: ps } = await supabase
        .from('processed_signals')
        .select('event_id, status, created_at')
        .eq('site_id', internalSiteId)
        .order('created_at', { ascending: false })
        .limit(3);
      const recentPs = (ps || []).filter((r) => new Date(r.created_at) >= t0);
      if (recentPs.length === 0) {
        throw new Error(
          'event_row_missing_no_processed_signals: SYNC_API_URL ile aynı Supabase projesini ' +
            'kullandığınızdan emin olun (.env.local NEXT_PUBLIC_SUPABASE_URL) veya worker ' +
            'ingest (traffic_debloat/skip) loglarına bakın'
        );
      }
      throw new Error(
        'event_row_missing_but_processed_signals: worker kısmi çalışmış olabilir (events insert?)'
      );
    }
    return data[0];
  });

  const callRow = await retry(`DB calls [${domain}]`, async () => {
    const { data, error } = await supabase
      .from('calls')
      .select('id, status, created_at, matched_session_id')
      .eq('site_id', internalSiteId)
      .gte('created_at', t0.toISOString())
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) throw error;
    if (!data?.[0]) throw new Error('call_row_missing');
    return data[0];
  });

  return { domain, sid, eventId: eventRow.id, callId: callRow.id };
}

async function main() {
  console.log('🧪 P0 Multi-Site Intent Test');
  console.log(JSON.stringify({ SYNC_API_URL, SITES }, null, 2));

  const results = [];
  for (let i = 0; i < SITES.length; i++) {
    const domain = SITES[i];
    console.log(`\n--- Site ${i + 1}/${SITES.length}: ${domain} ---`);
    const siteInfo = await findSiteByDomain(domain);
    if (!siteInfo) {
      console.warn(`⚠️  Site not found for domain: ${domain}`);
      results.push({ domain, ok: false, reason: 'site_not_found' });
      continue;
    }
    try {
      const r = await runTestForSite(siteInfo);
      console.log(`✅ ${domain}: event=${r.eventId}, call=${r.callId}`);
      results.push({ domain, ok: true, ...r });
    } catch (err) {
      console.error(`❌ ${domain}:`, err?.message || err);
      results.push({ domain, ok: false, reason: err?.message });
    }
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  console.log('\n## Özet');
  console.log(JSON.stringify(results, null, 2));
  if (failed.length > 0) {
    console.error(`\n❌ ${failed.length}/${SITES.length} site FAIL`);
    process.exit(1);
  }
  console.log(`\n✅ ${passed}/${SITES.length} site PASS`);
}

main().catch((err) => {
  console.error('❌', err?.message || err);
  process.exit(1);
});
