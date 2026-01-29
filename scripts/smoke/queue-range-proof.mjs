import dotenv from 'dotenv';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PROOF_URL = process.env.PROOF_URL;
const PROOF_SITE_ID = process.env.PROOF_SITE_ID;

const TRT_UTC_OFFSET_MS = 3 * 60 * 60 * 1000;

function getSiteId() {
  if (PROOF_SITE_ID) return PROOF_SITE_ID;
  if (!PROOF_URL) return '01d24667-ca9a-44e3-ab7a-7cd171ae653f';
  try {
    const u = new URL(PROOF_URL);
    const parts = u.pathname.split('/').filter(Boolean);
    const idx = parts.findIndex((p) => p === 'site');
    if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
  } catch {
    // ignore
  }
  return '01d24667-ca9a-44e3-ab7a-7cd171ae653f';
}

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

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing env: NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY');
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const siteId = getSiteId();
  const { todayKey, today, yesterday } = computeRanges();

  async function callRange(label, range) {
    let { data, error } = await supabase.rpc('get_recent_intents_v2', {
      p_site_id: siteId,
      p_date_from: range.fromIso,
      p_date_to: range.toIso,
      p_limit: 500,
      p_ads_only: true,
    });

    if (error) {
      // fallback to v1 if v2 isn't deployed yet
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
      console.log(`[${label}] WARN v2 missing; used v1 fallback`);
    }

    const arr = Array.isArray(data) ? data : [];
    const fromMs = Date.parse(range.fromIso);
    const toMs = Date.parse(range.toIso);
    const inRange = arr.filter((r) => {
      const ts = Date.parse(r?.created_at || '');
      return Number.isFinite(ts) && ts >= fromMs && ts <= toMs;
    });

    const created = inRange
      .map((r) => r?.created_at)
      .filter(Boolean)
      .sort();

    console.log(`[${label}] site=${siteId}`);
    console.log(`  from=${range.fromIso}`);
    console.log(`  to  =${range.toIso}`);
    console.log(`  count=${inRange.length}`);
    if (created.length) {
      console.log(`  first=${created[0]}`);
      console.log(`  last =${created[created.length - 1]}`);
    }
  }

  console.log(`TRT todayKey=${todayKey}`);
  await callRange('today', today);
  await callRange('yesterday', yesterday);
}

await main();

