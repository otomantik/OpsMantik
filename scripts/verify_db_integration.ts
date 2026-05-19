/**
 * NON_PROD_ONLY diagnostic script.
 * Guarded to fail-closed in production-like environments.
 */
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
  
  // Queue-only: verify journal enqueue path (no retired audit table).
  
  const { adminClient } = await import('../lib/supabase/admin');
  const { computeLcv } = await import('../lib/oci/lcv-engine');
  const { buildOptimizationSnapshot } = await import('../lib/oci/optimization-contract');
  const { OPSMANTIK_CONVERSION_NAMES } = await import('../lib/oci/conversion-names');
  
  const callId = '36713837-143f-4e19-9524-811c05d7b5bf'; // Example existing call
  const siteId = '28cf0aefaa074f5bb29e818a9d53b488';
  
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
  const occurredAtIso = typeof call.created_at === 'string' ? call.created_at : new Date().toISOString();

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

  void OPSMANTIK_CONVERSION_NAMES;
  void lcv;
  void canonicalValue;

  const { ensureOciQueueEnqueue } = await import('../lib/oci/ensure-oci-queue-enqueue');
  console.log('Enqueue journal row (contacted)...');
  const result = await ensureOciQueueEnqueue({
    siteId,
    callId,
    stage: 'contacted',
    occurredAt: new Date(occurredAtIso),
    leadScore: 0,
    currency: 'TRY',
    gclid: call.gclid || 'test_gclid',
    wbraid: call.wbraid ?? null,
    gbraid: call.gbraid ?? null,
    source: 'VERIFICATION_SCRIPT',
    traceId: null,
  });

  console.log('Queue enqueue result:', result.reasonCode, result.queueId ?? '(none)');
}

verifySignalGeneration();
