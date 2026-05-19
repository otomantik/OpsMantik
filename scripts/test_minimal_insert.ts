/**
 * NON_PROD_ONLY diagnostic script — journal queue smoke insert.
 */
import { adminClient } from '../lib/supabase/admin';
import { getDbNowIso } from '../lib/time/db-now';
import { OPSMANTIK_CONVERSION_NAMES } from '../lib/oci/conversion-names';

function assertDiagnosticWriteAllowed(): void {
  const isProdLike =
    process.env.NODE_ENV === 'production' ||
    process.env.VERCEL_ENV === 'production' ||
    process.env.OCI_ENV === 'production';
  if (isProdLike || process.env.ALLOW_DIAGNOSTIC_WRITES !== '1') {
    throw new Error('NON_PROD_ONLY: set ALLOW_DIAGNOSTIC_WRITES=1 in non-production environments only');
  }
}

async function testMinimalInsert() {
  assertDiagnosticWriteAllowed();
  const siteId = process.env.DIAGNOSTIC_SITE_ID ?? '28cf0aefaa074f5bb29e818a9d53b488';
  const callId = process.env.DIAGNOSTIC_CALL_ID ?? '36713837-143f-4e19-9524-811c05d7b5bf';
  const nowIso = await getDbNowIso();

  const { data, error } = await adminClient
    .from('offline_conversion_queue')
    .insert({
      site_id: siteId,
      call_id: callId,
      action: OPSMANTIK_CONVERSION_NAMES.contacted,
      status: 'QUEUED',
      value_cents: 1000,
      currency_code: 'TRY',
      value_source: 'stage_model',
      value_policy_version: 'oci_conversion_value_policy_v1',
      value_policy_reason: 'diagnostic_script',
      value_fallback_used: false,
      gclid: 'test_schema_gclid_min_len_xxxxxxxx',
      occurred_at: nowIso,
      conversion_time: nowIso,
    })
    .select('id')
    .single();

  console.log('Queue insert:', error ? error.message : data?.id);
  if (data?.id) {
    await adminClient.from('offline_conversion_queue').delete().eq('id', data.id);
    console.log('Cleanup done.');
  }
}

testMinimalInsert();
