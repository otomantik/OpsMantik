/**
 * Performance baseline: measure key RPC and API latencies (no new deps).
 *
 * Usage:
 *   node scripts/perf/measure-baseline.mjs
 *   BASE_URL=http://localhost:3000 node scripts/perf/measure-baseline.mjs  # include /api/stats/realtime
 *
 * Env: .env.local (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or ANON_KEY; optional TEST_SITE_ID, BASE_URL)
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const baseUrl = process.env.BASE_URL || '';

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or Supabase key');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Targets (ms) — guidelines only
const TARGETS = {
  get_recent_intents_v2: 2000,
  get_command_center_p0_stats_v2: 1500,
  '/api/stats/realtime': 500,
};

function status(ms, target) {
  if (ms <= target) return '✅';
  if (ms <= target * 1.5) return '⚠️';
  return '❌';
}

async function timeRpc(name, fn) {
  const start = performance.now();
  try {
    await fn();
    const ms = Math.round(performance.now() - start);
    const target = TARGETS[name];
    const s = target != null ? status(ms, target) : '';
    return { ok: true, ms, target, status: s };
  } catch (e) {
    const ms = Math.round(performance.now() - start);
    return { ok: false, ms, error: e?.message };
  }
}

async function timeFetch(name, url, opts = {}) {
  const start = performance.now();
  try {
    const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(15000) });
    await res.text();
    const ms = Math.round(performance.now() - start);
    const target = TARGETS[name];
    const s = target != null ? status(ms, target) : '';
    return { ok: res.ok, ms, target, status: s, error: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (e) {
    const ms = Math.round(performance.now() - start);
    const msg = e?.message || '';
    const hint = msg.toLowerCase().includes('fetch failed') || msg.includes('ECONNREFUSED')
      ? ' (app running at BASE_URL? CORS allows it?)'
      : '';
    return { ok: false, ms, error: msg + hint };
  }
}

async function main() {
  console.log('📊 Performance baseline\n');

  let siteId = process.env.TEST_SITE_ID;
  if (!siteId) {
    const { data: sites, error } = await supabase.from('sites').select('id').limit(1);
    if (error) throw error;
    if (!sites?.[0]?.id) throw new Error('No sites; set TEST_SITE_ID or ensure DB has sites');
    siteId = sites[0].id;
  }

  const now = new Date();
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // Today TRT range (simplified: use UTC day for script; app uses TRT)
  const todayStart = new Date(now);
  todayStart.setUTCHours(0, 0, 0, 0);

  console.log('Site:', siteId);
  console.log('');

  // 1) get_recent_intents_v2 (last 2h, limit 50, ads_only true)
  const r1 = await timeRpc('get_recent_intents_v2', () =>
    supabase.rpc('get_recent_intents_v2', {
      p_site_id: siteId,
      p_date_from: twoHoursAgo.toISOString(),
      p_date_to: now.toISOString(),
      p_limit: 50,
      p_ads_only: true,
    })
  );
  console.log(
    r1.ok
      ? `  get_recent_intents_v2   ${r1.ms} ms  ${r1.status || ''}  (target ${r1.target} ms)`
      : `  get_recent_intents_v2   ${r1.ms} ms  ❌ ${r1.error}`
  );

  // 2) get_command_center_p0_stats_v2 (last 24h, ads_only true)
  const r2 = await timeRpc('get_command_center_p0_stats_v2', () =>
    supabase.rpc('get_command_center_p0_stats_v2', {
      p_site_id: siteId,
      p_date_from: twentyFourHoursAgo.toISOString(),
      p_date_to: now.toISOString(),
      p_ads_only: true,
    })
  );
  console.log(
    r2.ok
      ? `  get_command_center_p0_stats_v2  ${r2.ms} ms  ${r2.status || ''}  (target ${r2.target} ms)`
      : `  get_command_center_p0_stats_v2  ${r2.ms} ms  ❌ ${r2.error}`
  );

  // 3) GET /api/stats/realtime (if BASE_URL set) — try 127.0.0.1 then original URL (Windows localhost fix)
  if (baseUrl) {
    const rawOrigin = baseUrl.replace(/\/$/, '');
    const candidates = [];
    if (rawOrigin.includes('localhost') && !rawOrigin.includes('127.0.0.1')) {
      candidates.push({ origin: rawOrigin.replace(/localhost/i, '127.0.0.1'), label: '127.0.0.1' });
      candidates.push({ origin: rawOrigin, label: 'localhost' });
    } else {
      candidates.push({ origin: rawOrigin, label: '' });
    }
    let r3 = null;
    for (const { origin } of candidates) {
      const url = `${origin}/api/stats/realtime?siteId=${siteId}`;
      r3 = await timeFetch('/api/stats/realtime', url, { headers: { Origin: origin } });
      if (r3.ok) break;
    }
    if (r3?.ok) {
      const s = r3.ms <= TARGETS['/api/stats/realtime'] ? '✅' : '⚠️';
      console.log(
        `  /api/stats/realtime     ${r3.ms} ms  ${s}  (target ${r3.target} ms, optional)`
      );
    } else {
      console.log(
        '  /api/stats/realtime     — skipped (app’a ulaşılamadı; önce başka terminalde npm run dev çalıştır, .env.local’a BASE_URL=http://127.0.0.1:3000 ekle)'
      );
    }
  } else {
    console.log('  /api/stats/realtime     (skip; set BASE_URL to measure)');
  }

  console.log('');
  const failed = [r1, r2].filter((r) => !r.ok);
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
