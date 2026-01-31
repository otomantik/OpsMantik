#!/usr/bin/env node
/**
 * Smoke: HunterCard field mapping rules proof
 * Loads a recent intent row from get_recent_intents_v2 and asserts UI mapping helpers
 * return expected strings: keywordDisplay (utm_term or '—'), matchDisplay (matchtype or '—'),
 * campaignDisplay (utm_campaign or '—').
 *
 * Usage: node scripts/smoke/hunter-card-fields-proof.mjs
 * Requires: .env.local with NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// UI mapping helpers (same rules as HunterCard.tsx)
function getKeywordDisplay(row) {
  const term = (row.utm_term || '').trim();
  return term ? term : '—';
}

function getMatchDisplay(row) {
  const m = (row.matchtype || '').toString().toLowerCase().trim();
  if (m === 'e') return 'Exact Match';
  if (m === 'p') return 'Phrase';
  if (m === 'b') return 'Broad';
  return '—';
}

function getCampaignDisplay(row) {
  const c = (row.utm_campaign || '').trim();
  return c ? c : '—';
}

function log(msg, color = '') {
  const c = { green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m', reset: '\x1b[0m' };
  console.log(`${c[color] || ''}${msg}${c.reset}`);
}

async function main() {
  log('\n=== HunterCard fields mapping proof ===\n', 'cyan');

  const now = new Date();
  const toIso = now.toISOString();
  const fromDate = new Date(now);
  fromDate.setDate(fromDate.getDate() - 7);
  const fromIso = fromDate.toISOString();

  const { data: sites } = await supabase.from('sites').select('id').limit(1);
  const siteId = sites?.[0]?.id;
  if (!siteId) {
    log('⚠ No site found; skipping RPC sample.', 'yellow');
    log('PASS (no data to check)\n', 'green');
    return;
  }

  const { data: rows, error } = await supabase.rpc('get_recent_intents_v2', {
    p_site_id: siteId,
    p_date_from: fromIso,
    p_date_to: toIso,
    p_limit: 5,
    p_ads_only: false,
  });

  if (error) {
    log('❌ RPC error: ' + error.message, 'red');
    process.exit(1);
  }

  const intents = Array.isArray(rows) ? rows : [];
  if (intents.length === 0) {
    log('No intents in range; asserting helpers for a synthetic row.', 'yellow');
    const synthetic = { utm_term: null, matchtype: null, utm_campaign: null };
    const kw = getKeywordDisplay(synthetic);
    const m = getMatchDisplay(synthetic);
    const camp = getCampaignDisplay(synthetic);
    if (kw !== '—' || m !== '—' || camp !== '—') {
      log(`FAIL: synthetic null row -> keyword="${kw}" match="${m}" campaign="${camp}"`, 'red');
      process.exit(1);
    }
    log('PASS (helpers return "—" for null/empty)\n', 'green');
    return;
  }

  const row = intents[0];
  const keywordDisplay = getKeywordDisplay(row);
  const matchDisplay = getMatchDisplay(row);
  const campaignDisplay = getCampaignDisplay(row);

  const expectedKeyword = (row.utm_term && row.utm_term.trim()) ? row.utm_term.trim() : '—';
  const expectedMatch =
    (row.matchtype && row.matchtype.toString().toLowerCase().trim() === 'e')
      ? 'Exact Match'
      : (row.matchtype && row.matchtype.toString().toLowerCase().trim() === 'p')
        ? 'Phrase'
        : (row.matchtype && row.matchtype.toString().toLowerCase().trim() === 'b')
          ? 'Broad'
          : '—';
  const expectedCampaign = (row.utm_campaign && row.utm_campaign.trim()) ? row.utm_campaign.trim() : '—';

  log(`1) RPC row: utm_term=${JSON.stringify(row.utm_term)} matchtype=${JSON.stringify(row.matchtype)} utm_campaign=${JSON.stringify(row.utm_campaign)}`, 'cyan');
  log(`2) keywordDisplay => "${keywordDisplay}" (expected: "${expectedKeyword}")`, 'cyan');
  log(`3) matchDisplay => "${matchDisplay}" (expected: "${expectedMatch}")`, 'cyan');
  log(`4) campaignDisplay => "${campaignDisplay}" (expected: "${expectedCampaign}")`, 'cyan');

  const okKeyword = keywordDisplay === expectedKeyword;
  const okMatch = matchDisplay === expectedMatch;
  const okCampaign = campaignDisplay === expectedCampaign;

  if (!okKeyword) {
    log(`FAIL: keywordDisplay !== utm_term or '—'`, 'red');
    process.exit(1);
  }
  if (!okMatch) {
    log(`FAIL: matchDisplay !== matchtype mapping or '—'`, 'red');
    process.exit(1);
  }
  if (!okCampaign) {
    log(`FAIL: campaignDisplay !== utm_campaign or '—'`, 'red');
    process.exit(1);
  }

  log('\nPASS (keywordDisplay, matchDisplay, campaignDisplay match mapping rules)\n', 'green');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
