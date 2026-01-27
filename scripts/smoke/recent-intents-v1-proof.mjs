#!/usr/bin/env node
/**
 * Live Inbox RPC proof: get_recent_intents_v1
 *
 * Env:
 * - NEXT_PUBLIC_SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
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

async function pickSiteId() {
  const fromIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('calls')
    .select('site_id, created_at, source')
    .eq('source', 'click')
    .not('intent_action', 'is', null)
    .gte('created_at', fromIso)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  if (data?.[0]?.site_id) return data[0].site_id;

  // fallback: any site
  const { data: sites, error: sitesErr } = await supabase.from('sites').select('id').limit(1);
  if (sitesErr) throw sitesErr;
  if (!sites?.[0]?.id) throw new Error('No sites found');
  return sites[0].id;
}

async function main() {
  const siteId = await pickSiteId();
  const { data: rows60, error: err60 } = await supabase.rpc('get_recent_intents_v1', {
    p_site_id: siteId,
    p_since: null,
    p_minutes_lookback: 60,
    p_limit: 5,
    p_ads_only: true,
  });
  if (err60) throw err60;

  const { data: rows24h, error: err24 } = await supabase.rpc('get_recent_intents_v1', {
    p_site_id: siteId,
    p_since: null,
    p_minutes_lookback: 1440,
    p_limit: 5,
    p_ads_only: true,
  });
  if (err24) throw err24;

  console.log('## get_recent_intents_v1 (last 60m, 5 rows)');
  console.log(JSON.stringify({ siteId, rows: rows60 }, null, 2));
  console.log('## get_recent_intents_v1 (last 24h, 5 rows)');
  console.log(JSON.stringify({ siteId, rows: rows24h }, null, 2));
  console.log('✅ PASS');
}

main().catch((e) => {
  console.error('❌ FAIL:', e?.message || e);
  process.exit(1);
});

