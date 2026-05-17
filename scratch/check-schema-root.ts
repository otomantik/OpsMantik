
import { adminClient } from './lib/supabase/admin';

type PgTableRow = { tablename: string };

async function listAllTablesAndGclidRelations() {
  try {
    // 1. Get all table names
    const { data: tables, error } = await adminClient
      .rpc('get_table_names'); // If this RPC exists

    if (error) {
      // Fallback: Use a generic query to information_schema if allowed
      const { data: schemaTables } = await adminClient
        .from('pg_tables' as unknown as 'pg_tables')
        .select('tablename')
        .eq('schemaname', 'public');
      console.log('Tables in public schema:', (schemaTables as unknown as PgTableRow[] | null)?.map(t => t.tablename));
    } else {
      console.log('Tables:', tables);
    }

    // 2. Search for any table containing 'gclid' or 'ads'
    const { data: adsTables } = await adminClient
      .from('pg_attribute' as unknown as 'pg_attribute')
      .select('relname:pg_class(relname)')
      .ilike('attname', '%gclid%')
      .eq('attisdropped', false);
    
    console.log('\nTables with GCLID-related columns:', adsTables);

  } catch (e) {
    console.error(e);
  }
}

listAllTablesAndGclidRelations();
