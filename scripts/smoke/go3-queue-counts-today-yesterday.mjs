/**
 * GO3 SQL proof: Print pending intents count for today vs yesterday (TRT boundaries).
 * Uses get_recent_intents_v2 with date_from/date_to; same logic as DashboardShell + QualificationQueue.
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PROOF_SITE_ID = process.env.PROOF_SITE_ID || '01d24667-ca9a-44e3-ab7a-7cd171ae653f';

const TRT_UTC_OFFSET_MS = 3 * 60 * 60 * 1000;

function pad2(n) {
  return String(n).padStart(2, '0');
}

function getTodayTrtDateKey(nowUtc = new Date()) {
  const trtNow = new Date(nowUtc.getTime() + TRT_UTC_OFFSET_MS);
  const y = trtNow.getUTCFullYear();
  const m = trtNow.getUTCMonth() + 1;
  const d = trtNow.getUTCDate();
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function trtDateKeyToUtcDayStartMs(dateKey) {
  const [ys, ms, ds] = dateKey.split('-');
  const y = Number(ys);
  const m = Number(ms);
  const d = Number(ds);
  return Date.UTC(y, m - 1, d, 0, 0, 0, 0) - TRT_UTC_OFFSET_MS;
}

function computeRanges() {
  const nowUtc = new Date();
  const todayKey = getTodayTrtDateKey(nowUtc);
  const todayStartMs = trtDateKeyToUtcDayStartMs(todayKey);

  const today = {
    fromIso: new Date(todayStartMs).toISOString(),
    toIso: nowUtc.toISOString(),
  };

  const yesterday = {
    fromIso: new Date(todayStartMs - 24 * 60 * 60 * 1000).toISOString(),
    toIso: new Date(todayStartMs - 1).toISOString(),
  };

  return { todayKey, today, yesterday };
}

function filterPending(arr, fromIso, toIso) {
  const fromMs = Date.parse(fromIso);
  const toMs = Date.parse(toIso);
  return arr.filter((r) => {
    const ts = Date.parse(r?.created_at || '');
    if (!Number.isFinite(ts)) return false;
    if (ts < fromMs || ts > toMs) return false;
    const status = (r?.status ?? null) ? String(r.status).toLowerCase() : null;
    return status === null || status === 'intent';
  });
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const siteId = PROOF_SITE_ID;
  const { todayKey, today, yesterday } = computeRanges();

  async function countForRange(label, range) {
    let { data, error } = await supabase.rpc('get_recent_intents_v2', {
      p_site_id: siteId,
      p_date_from: range.fromIso,
      p_date_to: range.toIso,
      p_limit: 500,
      p_ads_only: true,
    });

    if (error) {
      const v1 = await supabase.rpc('get_recent_intents_v1', {
        p_site_id: siteId,
        p_since: range.fromIso,
        p_minutes_lookback: 24 * 60,
        p_limit: 500,
        p_ads_only: true,
      });
      data = v1.data;
      error = v1.error;
      if (error) throw error;
    }

    const arr = Array.isArray(data) ? data : [];
    const pending = filterPending(arr, range.fromIso, range.toIso);
    return { label, total: arr.length, pending: pending.length, from: range.fromIso, to: range.toIso };
  }

  const todayResult = await countForRange('Today', today);
  const yesterdayResult = await countForRange('Yesterday', yesterday);

  console.log('--- GO3 Queue counts (TRT day boundaries) ---');
  console.log(`Site: ${siteId}`);
  console.log(`TRT today key: ${todayKey}`);
  console.log('');
  console.log(`Today:   pending=${todayResult.pending} (total in range=${todayResult.total})`);
  console.log(`  from: ${todayResult.from}`);
  console.log(`  to:   ${todayResult.to}`);
  console.log('');
  console.log(`Yesterday: pending=${yesterdayResult.pending} (total in range=${yesterdayResult.total})`);
  console.log(`  from: ${yesterdayResult.from}`);
  console.log(`  to:   ${yesterdayResult.to}`);
  console.log('---');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
