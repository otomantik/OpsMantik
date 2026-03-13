
import { adminClient } from '../lib/supabase/admin';

async function checkSchema() {
  const { data, error } = await adminClient
    .from('marketing_signals')
    .select('*')
    .limit(1);

  if (error) {
    console.error('Error fetching data:', error);
    return;
  }

  if (data && data.length > 0) {
    const row = data[0];
    console.log('Columns in marketing_signals:');
    for (const key of Object.keys(row)) {
      console.log(`- ${key}: ${typeof row[key]} (Example: ${row[key]})`);
    }
  } else {
    console.log('No data in marketing_signals to inspect.');
  }
}

checkSchema();
