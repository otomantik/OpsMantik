#!/usr/bin/env node
/**
 * Today's pipeline check using TRT (Turkey) "today" range — same as dashboard.
 * Use this when diagnosing "no leads today" so numbers match the UI.
 *
 * Requires: .env.local with NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Run: node scripts/check-today-trt.mjs
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey);

const TRT_UTC_OFFSET_MS = 3 * 60 * 60 * 1000;

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** TRT "today" date key (YYYY-MM-DD). */
function getTodayTrtDateKey(nowUtc = new Date()) {
  const trtNow = new Date(nowUtc.getTime() + TRT_UTC_OFFSET_MS);
  const y = trtNow.getUTCFullYear();
  const m = trtNow.getUTCMonth() + 1;
  const d = trtNow.getUTCDate();
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/** TRT date key → UTC ISO range [from, to) for that TRT day. */
function trtDateKeyToUtcRange(dateKey) {
  const [ys, ms, ds] = dateKey.split('-');
  const y = Number(ys);
  const m = Number(ms);
  const d = Number(ds);
  if (!y || !m || !d) throw new Error(`Invalid TRT dateKey: ${dateKey}`);
  const fromUtcMs = Date.UTC(y, m - 1, d, 0, 0, 0, 0) - TRT_UTC_OFFSET_MS;
  const toUtcMs = fromUtcMs + 24 * 60 * 60 * 1000;
  return {
    fromIso: new Date(fromUtcMs).toISOString(),
    toIso: new Date(toUtcMs).toISOString(),
  };
}

/** TRT "today" UTC range [from, to). */
function getTodayTrtUtcRange(nowUtc = new Date()) {
  return trtDateKeyToUtcRange(getTodayTrtDateKey(nowUtc));
}

async function main() {
  const trtKey = getTodayTrtDateKey();
  const { fromIso, toIso } = getTodayTrtUtcRange();
  console.log('TRT today:', trtKey);
  console.log('UTC range: [', fromIso, ',', toIso, ')');
  console.log('');

  const { data: sites, error: sitesErr } = await supabase.from('sites').select('id, name');
  if (sitesErr || !sites?.length) {
    console.error('Sites error:', sitesErr?.message || 'no sites');
    process.exit(1);
  }

  for (const site of sites) {
    const [statsRes, breakdownRes] = await Promise.all([
      supabase.rpc('get_command_center_p0_stats_v2', {
        p_site_id: site.id,
        p_date_from: fromIso,
        p_date_to: toIso,
        p_ads_only: true,
      }),
      supabase.rpc('get_dashboard_breakdown_v1', {
        p_site_id: site.id,
        p_date_from: fromIso,
        p_date_to: toIso,
        p_ads_only: true,
      }),
    ]);

    const stats = statsRes.data;
    const breakdown = Array.isArray(breakdownRes.data) ? breakdownRes.data[0] : breakdownRes.data;
    const sessions = breakdown?.total_sessions ?? 0;
    const totalLeads = stats?.total_leads ?? 0;
    const sealed = stats?.sealed ?? 0;
    const pending = stats?.queue_pending ?? 0;

    console.log(`Site: ${site.name || site.id}`);
    console.log(`  Sessions (ads): ${sessions} | Intents: ${totalLeads} | Pending: ${pending} | Sealed: ${sealed}`);
    if (sessions === 0 && totalLeads === 0) {
      console.log('  → No traffic in range; check sync / QStash / worker (see docs/OPS/NO_LEADS_TODAY_DIAGNOSTIC.md)');
    } else if (sessions > 0 && totalLeads === 0) {
      console.log('  → Traffic present but no phone/WA clicks (intents); sealed will stay 0 until conversions.');
    } else if (totalLeads > 0 && sealed === 0) {
      console.log('  → Intents exist; sealed = 0 until calls are confirmed/qualified.');
    }
    console.log('');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
