
import { adminClient } from '../lib/supabase/admin';

async function testMinimalInsert() {
  const siteId = '28cf0aefaa074f5bb29e818a9d53b488';
  
  console.log('Test 1: Only signal_type and google_conversion_name');
  const t1 = await adminClient.from('marketing_signals').insert({
    site_id: siteId,
    signal_type: 'V3_TEST',
    google_conversion_name: 'TEST_NAME',
    google_conversion_time: new Date().toISOString(),
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
    google_conversion_time: new Date().toISOString(),
  }).select('id');
  console.log('T2 Result:', JSON.stringify(t2, null, 2));
}

testMinimalInsert();
