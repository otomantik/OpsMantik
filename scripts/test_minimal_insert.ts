/**
 * NON_PROD_ONLY diagnostic script.
 * Guarded to fail-closed in production-like environments.
 */
import { adminClient } from '../lib/supabase/admin';
import { getDbNowIso } from '../lib/time/db-now';

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
  const siteId = '28cf0aefaa074f5bb29e818a9d53b488';
  const nowIso = await getDbNowIso();
  
  console.log('Test 1: Only signal_type and google_conversion_name');
  const t1 = await adminClient.from('marketing_signals').insert({
    site_id: siteId,
    signal_type: 'V3_TEST',
    google_conversion_name: 'TEST_NAME',
    google_conversion_time: nowIso,
  }).select('id');
  console.log('T1 Result:', JSON.stringify(t1, null, 2));

  if (t1.error) {
    console.log('T1 Failed. If error mentions numeric, then google_conversion_name might be misaligned.');
  }

  console.log('Test 2: Adding conversion_value');
  const t2 = await adminClient.from('marketing_signals').insert({
    site_id: siteId,
    signal_type: 'V3_TEST',
    google_conversion_name: 'TEST_NAME_2',
    conversion_value: 0.01,
    google_conversion_time: nowIso,
  }).select('id');
  console.log('T2 Result:', JSON.stringify(t2, null, 2));
}

testMinimalInsert();
