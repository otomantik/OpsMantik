
import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { computeLcv } from '../lib/oci/lcv-engine';

config({ path: '.env.local' });

function getEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing env: ${key}`);
  return val;
}

test('Integration: LCV Signal Generation on marketing_signals', async (_t) => {
  const supabaseUrl = getEnv('NEXT_PUBLIC_SUPABASE_URL');
  const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Get a valid site and call (or create dummy)
  const { data: call } = await admin
    .from('calls')
    .select('id, site_id, city, district, device_os, traffic_source, whatsapp_clicks, total_duration_sec')
    .not('site_id', 'is', null)
    .limit(1)
    .maybeSingle();

  if (!call?.id) {
    console.log('No existing call found, creating test site and call...');
    const user = (await admin.auth.getUser()).data.user;
    const userId = user?.id || '00000000-0000-0000-0000-000000000000';
    console.log('Using User ID for test:', userId);

    const { data: site, error: siteCreateErr } = await admin.from('sites').insert({ 
      name: 'LCV_INTEGRATION_TEST_SITE',
      user_id: userId
    }).select('id').single();
    
    if (siteCreateErr) {
      console.error('Site creation failed:', siteCreateErr.message);
    }

    if (site) {
      console.log('Test site created:', site.id);
      const { data: newCall, error: callCreateErr } = await admin.from('calls').insert({ 
        site_id: site.id,
        city: 'İstanbul',
        district: 'Beşiktaş',
        device_os: 'iOS',
        traffic_source: 'branded',
        whatsapp_clicks: 1,
        total_duration_sec: 120,
        gclid: 'test_gclid_123'
      }).select('*').single();
      
      if (callCreateErr) {
        console.error('Call creation failed:', callCreateErr.message);
      }
      call = newCall as any;
    }
  }

  if (!call?.id) {
    console.error('FATAL: Could not resolve a call ID for testing.');
    assert.fail('Failed to find or create test data');
  }

  const siteId = call.site_id;
  const callId = call.id;

  // 2. Compute LCV
  const lcv = computeLcv({
    stage: 'V3',
    baseAov: 3000,
    city: call.city,
    district: call.district,
    deviceOs: call.device_os,
    trafficSource: call.traffic_source,
    whatsappClicks: call.whatsapp_clicks,
    totalDurationSec: call.total_duration_sec
  });

  const conversionName = 'OpsMantik_V3_Nitelikli_Gorusme';
  const now = new Date().toISOString();

  // 3. Insert into marketing_signals (exactly as the API does)
  const { data: signal, error: insertErr } = await admin
    .from('marketing_signals')
    .insert({
      site_id: siteId,
      call_id: callId,
      signal_type: 'MEETING_BOOKED',
      google_conversion_name: conversionName,
      google_conversion_time: now,
      conversion_value: lcv.valueUnits,
      expected_value_cents: lcv.valueCents,
      dispatch_status: 'PENDING',
      occurred_at: now,
      adjustment_sequence: 0,
      current_hash: 'integration_test_hash_' + Math.random().toString(36).substring(7),
      causal_dna: {
        lcv_stage: 'V3',
        lcv_quality_multiplier: lcv.qualityMultiplier,
        source: 'INTEGRATION_TEST'
      }
    })
    .select('id, conversion_value, google_conversion_name')
    .single();

  if (insertErr) {
    console.error('Insert Error Detail:', insertErr);
    assert.fail(`Insert failed: ${insertErr.message}`);
  }

  console.log('✅ Signal inserted correctly:', signal.id);
  assert.equal(signal.conversion_value, lcv.valueUnits);
  assert.equal(signal.google_conversion_name, conversionName);

  // 4. Cleanup
  await admin.from('marketing_signals').delete().eq('id', signal.id);
  console.log('✅ Cleanup successful.');
});
