/**
 * Smoke: is_ads_session_input() boolean classifier
 *
 * Runs 5 test cases (expected true/false) and prints results.
 *
 * Usage:
 *   node scripts/smoke/test_is_ads_session_input.mjs
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

const cases = [
  {
    name: 'gclid present => true',
    input: { p_gclid: 'Cj0KCQiA', p_wbraid: null, p_gbraid: null, p_utm_source: null, p_utm_medium: null, p_attribution_source: null },
    expected: true,
  },
  {
    name: 'utm_medium=cpc => true',
    input: { p_gclid: null, p_wbraid: null, p_gbraid: null, p_utm_source: 'google', p_utm_medium: 'cpc', p_attribution_source: null },
    expected: true,
  },
  {
    name: 'attribution_source contains Paid => true',
    input: { p_gclid: null, p_wbraid: null, p_gbraid: null, p_utm_source: null, p_utm_medium: null, p_attribution_source: 'First Click (Paid)' },
    expected: true,
  },
  {
    name: 'utm_source=bing + utm_medium=ppc => true',
    input: { p_gclid: null, p_wbraid: null, p_gbraid: null, p_utm_source: 'bing', p_utm_medium: 'ppc', p_attribution_source: null },
    expected: true,
  },
  {
    name: 'no click IDs, organic utm => false',
    input: { p_gclid: null, p_wbraid: null, p_gbraid: null, p_utm_source: 'newsletter', p_utm_medium: 'email', p_attribution_source: 'Organic' },
    expected: false,
  },
];

async function main() {
  console.log('🧪 Smoke: is_ads_session_input()');

  const rows = [];
  for (const tc of cases) {
    const { data, error } = await supabase.rpc('is_ads_session_input', tc.input);
    if (error) throw error;
    const actual = !!data;
    rows.push({ case: tc.name, expected: tc.expected, actual, pass: actual === tc.expected });
  }

  console.table(rows);

  const failed = rows.filter((r) => !r.pass);
  if (failed.length) {
    console.error('❌ Some cases failed');
    process.exit(1);
  }
  console.log('✅ All cases passed');
}

main().catch((err) => {
  console.error('❌ Smoke failed:', err?.message || err);
  process.exit(1);
});

