
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const OPSMANTIK_CONTACTED = 'OpsMantik_Contacted';

async function verifyDb() {
  const isProdLike =
    process.env.NODE_ENV === 'production' ||
    process.env.VERCEL_ENV === 'production' ||
    process.env.OCI_ENV === 'production';
  if (isProdLike || process.env.ALLOW_DIAGNOSTIC_WRITES !== '1') {
    throw new Error('NON_PROD_ONLY: set ALLOW_DIAGNOSTIC_WRITES=1 in non-production environments only');
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error('Env missing');
    return;
  }

  const supabase = createClient(url, key);

  console.log('--- Step 1: offline_conversion_queue contacted row smoke insert ---');

  const { data: call } = await supabase.from('calls').select('id, site_id').limit(1).maybeSingle();

  const siteId = call?.site_id || '28cf0aefaa074f5bb29e818a9d53b488';
  const callId = call?.id || '36713837-143f-4e19-9524-811c05d7b5bf';
  const occurredAt = new Date().toISOString();

  const testPayload = {
    site_id: siteId,
    call_id: callId,
    action: OPSMANTIK_CONTACTED,
    status: 'QUEUED',
    value_cents: 1000,
    currency_code: 'TRY',
    value_source: 'stage_model',
    value_policy_version: 'oci_conversion_value_policy_v1',
    value_policy_reason: 'manual_verify_script',
    value_fallback_used: false,
    gclid: 'test_schema_gclid_min_len_xxxxxxxx',
    occurred_at: occurredAt,
    conversion_time: occurredAt,
  };

  const { data, error } = await supabase
    .from('offline_conversion_queue')
    .insert(testPayload)
    .select('id')
    .single();

  if (error) {
    console.error('Insert FAILED:', error.message);
    if (error.details) console.error('Details:', error.details);
    if (error.hint) console.error('Hint:', error.hint);
  } else {
    console.log('Insert SUCCESSFUL. Queue ID:', data.id);
    await supabase.from('offline_conversion_queue').delete().eq('id', data.id);
    console.log('Cleanup successful.');
  }
}

verifyDb();
