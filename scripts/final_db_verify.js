
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

/** SSOT: same literals as lib/domain/mizan-mantik/conversion-names.ts (contacted smoke row). */
const OPSMANTIK_CONTACTED = 'OpsMantik_Contacted';

async function verifyDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error('Env missing');
    return;
  }

  const supabase = createClient(url, key);

  console.log('--- Step 1: Checking for marketing_signals schema (SSOT contacted row) ---');

  const { data: call } = await supabase.from('calls').select('id, site_id').limit(1).maybeSingle();
  if (!call) {
    console.log('No call found, using dummy UUIDs for schema test...');
  }

  const siteId = call?.site_id || '28cf0aefaa074f5bb29e818a9d53b488';
  const callId = call?.id || '36713837-143f-4e19-9524-811c05d7b5bf';
  const now = new Date().toISOString();

  const testPayload = {
    site_id: siteId,
    call_id: callId,
    signal_type: 'contacted',
    optimization_stage: 'contacted',
    google_conversion_name: OPSMANTIK_CONTACTED,
    google_conversion_time: now,
    conversion_value: 9.6,
    optimization_value: 9.6,
    expected_value_cents: 960,
    currency_code: 'TRY',
    value_source: 'stage_model',
    conversion_time_source: 'ledger_stage_event',
    dispatch_status: 'PENDING',
    occurred_at: now,
    adjustment_sequence: 0,
    current_hash: 'manual_verification_hash_' + Date.now(),
    gclid: 'test_schema_gclid_min_len_xxxxxxxx',
    causal_dna: {
      optimization_stage: 'contacted',
      quality_factor: 0.96,
      source: 'MANUAL_VERIFY_SCRIPT_SSOT',
    },
  };

  console.log('Testing insert...');
  const { data, error } = await supabase.from('marketing_signals').insert(testPayload).select('id').single();

  if (error) {
    console.error('❌ Insert FAILED:', error.message);
    if (error.details) console.error('Details:', error.details);
    if (error.hint) console.error('Hint:', error.hint);
  } else {
    console.log('✅ Insert SUCCESSFUL! Signal ID:', data.id);

    await supabase.from('marketing_signals').delete().eq('id', data.id);
    console.log('✅ Cleanup successful.');
  }
}

verifyDb();
