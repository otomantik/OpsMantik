
import { adminClient } from '../lib/supabase/admin';

async function checkSchema() {
  const { data, error } = await adminClient
    .from('offline_conversion_queue')
    .select('*')
    .limit(1);

  if (error) {
    console.error('Error fetching data:', error);
    return;
  }

  if (data && data.length > 0) {
    const row = data[0];
    console.log('Columns in offline_conversion_queue (sample row):');
    for (const key of Object.keys(row)) {
      console.log(`- ${key}: ${typeof row[key]} (Example: ${row[key]})`);
    }
  } else {
    console.log('No data in offline_conversion_queue to inspect.');
  }
}

checkSchema();
