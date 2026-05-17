import { adminClient } from '@/lib/supabase/admin';

async function main() {
  console.log('Querying information_schema.columns...');
  const { data: columns, error: colErr } = await adminClient.rpc('execute_sql', {
    query: `
      SELECT column_name, data_type, character_maximum_length, column_default
      FROM information_schema.columns
      WHERE table_name = 'offline_conversion_queue'
    `
  });
  
  if (colErr) {
    // If execute_sql is not available, we can query via postgrest if exposed, but usually information_schema is not.
    console.error('Failed to query via rpc:', colErr);
  } else {
    console.log(columns);
  }
}

main().catch(console.error);
