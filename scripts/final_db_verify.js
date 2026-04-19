
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

async function verifyDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error('Env missing');
    return;
  }

  const supabase = createClient(url, key);

  console.log('--- Step 1: Checking for marketing_signals schema ---');
  
  // Try to find a call to associate with
  const { data: call } = await supabase.from('calls').select('id, site_id').limit(1).maybeSingle();
  if (!call) {
    console.log('No call found, using dummy UUIDs for schema test...');
  }
  
  const siteId = call?.site_id || '28cf0aefaa074f5bb29e818a9d53b488';
  const callId = call?.id || '36713837-143f-4e19-9524-811c05d7b5bf'; 
  const now = new Date().toISOString();

  // This matches exactly what I wrote in app/api/calls/[id]/seal/route.ts
  const testPayload = {
    site_id: siteId,
    call_id: callId,
    signal_type: 'gorusuldu',
    optimization_stage: 'gorusuldu',
    google_conversion_name: 'OpsMantik_Gorusuldu',
    google_conversion_time: now,
    conversion_value: 9.6,
    optimization_value: 9.6,
    expected_value_cents: 960,
    dispatch_status: 'PENDING',
    occurred_at: now,
    adjustment_sequence: 0,
    current_hash: 'manual_verification_hash_' + Date.now(),
    causal_dna: {
      optimization_stage: 'gorusuldu',
      quality_factor: 0.96,
      source: 'MANUAL_VERIFY_SCRIPT'
    }
  };

  console.log('Testing insert...');
  const { data, error } = await supabase.from('marketing_signals').insert(testPayload).select('id').single();

  if (error) {
    console.error('❌ Insert FAILED:', error.message);
    if (error.details) console.error('Details:', error.details);
    if (error.hint) console.error('Hint:', error.hint);
  } else {
    console.log('✅ Insert SUCCESSFUL! Signal ID:', data.id);
    
    // Cleanup
    await supabase.from('marketing_signals').delete().eq('id', data.id);
    console.log('✅ Cleanup successful.');
  }
}

verifyDb();
