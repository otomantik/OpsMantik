/**
 * NON_PROD_ONLY diagnostic script.
 * Guarded to fail-closed in production-like environments.
 */
import { getDbNowIso } from '../lib/time/db-now';

// We need to mock the Request and the Auth
// Since the route uses createServerClient and adminClient, it's heavily environment dependent.
// For verification, I will check the code once more and then perform a "live" check on the DB 
// to see if any signals were generated for the test call.

async function verifySignalGeneration() {
  const isProdLike =
    process.env.NODE_ENV === 'production' ||
    process.env.VERCEL_ENV === 'production' ||
    process.env.OCI_ENV === 'production';
  if (isProdLike || process.env.ALLOW_DIAGNOSTIC_WRITES !== '1') {
    throw new Error('NON_PROD_ONLY: set ALLOW_DIAGNOSTIC_WRITES=1 in non-production environments only');
  }

  console.log('--- Verifying Signal Generation Logic ---');
  
  // Actually, I'll just check the DB directly to see if any marketing_signals exist for my test call
  // from when I ran the earlier manual tests (if they reached the insert).
  // But they didn't because of the "Unauthorized" check.
  
  // I'll create a dedicated script that uses adminClient to manually generate a signal 
  // exactly as the API would, to verify the SQL/Schema works.
  
  const { adminClient } = await import('../lib/supabase/admin');
  const { computeLcv } = await import('../lib/oci/lcv-engine');
  const { buildOptimizationSnapshot } = await import('../lib/oci/optimization-contract');
  const { OPSMANTIK_CONVERSION_NAMES } = await import('../lib/domain/mizan-mantik/conversion-names');
  
  const callId = '36713837-143f-4e19-9524-811c05d7b5bf'; // Example existing call
  const siteId = '28cf0aefaa074f5bb29e818a9d53b488';
  const confirmedAtIso = await getDbNowIso();
  
  console.log('Fetching call data...');
  const { data: call } = await adminClient
    .from('calls')
    .select('*')
    .eq('id', callId)
    .eq('site_id', siteId)
    .single();
  
  if (!call) {
    console.log('Test call not found. Please provide a valid call ID.');
    return;
  }

  console.log('Computing LCV (Stage contacted)...');
  const lcv = computeLcv({
    stage: 'contacted',
    baseAov: 3000,
    city: call.city,
    district: call.district,
    deviceOs: call.device_os,
    trafficSource: call.traffic_source,
    whatsappClicks: call.whatsapp_clicks,
    totalDurationSec: call.total_duration_sec
  });
  const canonicalValue = buildOptimizationSnapshot({
    stage: 'contacted',
    systemScore: lcv.breakdown.systemScore,
  });

  const { loadMarketingSignalEconomics } = await import('../lib/oci/marketing-signal-value-ssot');
  const economics = await loadMarketingSignalEconomics({
    siteId,
    stage: 'contacted',
    snapshot: canonicalValue,
  });

  const conversionName = OPSMANTIK_CONVERSION_NAMES.contacted;

  console.log('Writing to marketing_signals...');
  const { data: signal, error } = await adminClient.from('marketing_signals').insert({
    site_id: siteId,
    call_id: callId,
    signal_type: 'contacted',
    google_conversion_name: conversionName,
    google_conversion_time: confirmedAtIso,
    currency_code: economics.currencyCode,
    value_source: economics.valueSource,
    conversion_time_source: economics.conversionTimeSource,
    conversion_value: economics.conversionValueMajor,
    expected_value_cents: economics.expectedValueCents,
    optimization_stage: canonicalValue.optimizationStage,
    optimization_stage_base: canonicalValue.stageBase,
    system_score: canonicalValue.systemScore,
    quality_factor: canonicalValue.qualityFactor,
    optimization_value: economics.conversionValueMajor,
    gclid: call.gclid || 'test_gclid',
    dispatch_status: 'PENDING',
    occurred_at: confirmedAtIso,
    adjustment_sequence: 0,
    current_hash: 'test_hash_verified',
    causal_dna: {
      lcv_stage: 'contacted',
      lcv_quality_multiplier: lcv.qualityMultiplier,
      source: 'VERIFICATION_SCRIPT'
    }
  }).select('id').single();

  if (error) {
    console.error('❌ DB Insert Failed:', error.message);
  } else {
    console.log('✅ Signal Generated Successfully! ID:', signal.id);
    
    // Cleanup
    await adminClient.from('marketing_signals').delete().eq('id', signal.id);
    console.log('Cleanup done.');
  }
}

verifySignalGeneration();
