/**
 * GO1 Casino Kasa — SQL verification (run after migration).
 * Uses service_role to run b) and d). Run a) and c) in Supabase SQL Editor and paste into PROOF_PACK.
 *
 * Prereq: Migration 20260130100000_casino_kasa_calls_sites.sql applied.
 * Usage: node scripts/smoke/go1-casino-db-verify.mjs
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

async function main() {
  console.log('--- a) Run in SQL Editor; paste result into PROOF_PACK ---');
  console.log(`
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'calls'
  AND column_name IN ('sale_amount', 'estimated_value', 'currency', 'updated_at')
ORDER BY ordinal_position;

SELECT column_name, data_type, column_default FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'sites' AND column_name = 'config';
`);

  console.log('--- b) Update sale_amount (service_role) ---');
  const { data: calls } = await supabase.from('calls').select('id, site_id, sale_amount, currency').limit(1).maybeSingle();
  if (calls?.id) {
    const { data: up, error: uErr } = await supabase.from('calls').update({ sale_amount: 99.5, currency: 'TRY' }).eq('id', calls.id).select('id, sale_amount, currency').single();
    console.log(uErr ? 'Error: ' + uErr.message : 'Updated: ' + JSON.stringify(up));
    await supabase.from('calls').update({ sale_amount: null }).eq('id', calls.id);
  } else {
    console.log('No call row; skip b) or run after migration with data.');
  }

  console.log('\n--- c) Run in SQL Editor: UPDATE calls SET sale_amount = -1 WHERE id = (SELECT id FROM calls LIMIT 1); Expected: check constraint violation ---');

  console.log('\n--- d) sites.config default and update ---');
  const { data: site } = await supabase.from('sites').select('id, config').limit(1).maybeSingle();
  console.log('One site config:', JSON.stringify(site?.config));
  if (site?.id) {
    const { error: u2 } = await supabase.from('sites').update({ config: { bounty_chips: { low: 100 }, currency: 'TRY' } }).eq('id', site.id);
    console.log('Update config:', u2 ? 'Error: ' + u2.message : 'OK');
  }
  console.log('\nDone. Paste outputs into PROOF_PACK.');
}

main().catch((e) => { console.error(e); process.exit(1); });
