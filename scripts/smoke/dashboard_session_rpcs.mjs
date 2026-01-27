/**
 * Smoke Test: Dashboard Session RPCs (P0)
 *
 * Tests:
 * 1) get_dashboard_intents -> find a row with matched_session_id
 * 2) get_session_details(site_id, matched_session_id) -> validate shape
 *
 * Usage:
 *   node scripts/smoke/dashboard_session_rpcs.mjs
 *
 * Env:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY (preferred) OR NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   TEST_SITE_ID (optional)
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

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE key');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log('🧪 Smoke: Dashboard Session RPCs\n');

  let siteId = process.env.TEST_SITE_ID;
  if (!siteId) {
    const { data: sites, error } = await supabase.from('sites').select('id').limit(1);
    if (error) throw error;
    if (!sites?.[0]?.id) throw new Error('No sites found');
    siteId = sites[0].id;
  }

  const dateTo = new Date();
  const dateFrom = new Date();
  dateFrom.setDate(dateFrom.getDate() - 7);

  console.log('📌 siteId:', siteId);

  const { data: intents, error: intentsError } = await supabase.rpc('get_dashboard_intents', {
    p_site_id: siteId,
    p_date_from: dateFrom.toISOString(),
    p_date_to: dateTo.toISOString(),
    p_status: null,
    p_search: null,
  });

  if (intentsError) throw intentsError;
  if (!Array.isArray(intents)) throw new Error('get_dashboard_intents: expected array');

  // Find the first intent whose matched_session_id resolves via get_session_details
  let sessionId = null;
  let sessionRows = null;
  for (const i of intents) {
    if (!i || typeof i !== 'object' || !i.matched_session_id) continue;
    const candidate = i.matched_session_id;
    const { data: rows, error } = await supabase.rpc('get_session_details', {
      p_site_id: siteId,
      p_session_id: candidate,
    });
    if (error) continue;
    if (Array.isArray(rows) && rows.length === 1) {
      sessionId = candidate;
      sessionRows = rows;
      break;
    }
  }

  if (!sessionId || !sessionRows) {
    throw new Error('No Ads-origin matched_session_id found (get_session_details returned empty for all candidates)');
  }

  console.log('📌 matched_session_id:', sessionId);

  const s = sessionRows[0];
  const required = ['id', 'site_id', 'created_at', 'created_month'];
  for (const k of required) {
    if (!(k in s)) throw new Error(`get_session_details: missing field ${k}`);
  }
  if (s.id !== sessionId) throw new Error('get_session_details: id mismatch');
  if (s.site_id !== siteId) throw new Error('get_session_details: site_id mismatch');

  console.log('✅ get_session_details: PASS');
  console.log('✅ Smoke: PASS');
}

main().catch((err) => {
  console.error('❌ Smoke: FAIL');
  console.error(err?.message || err);
  process.exit(1);
});

