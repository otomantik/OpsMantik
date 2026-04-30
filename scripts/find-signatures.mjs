
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function findFunction() {
  console.log('Searching for apply_call_action_v1/v2 signatures...');
  
  // Custom query via pg_proc
  const query = `
    SELECT 
      p.proname as name,
      pg_catalog.pg_get_function_arguments(p.oid) as args,
      pg_catalog.pg_get_function_result(p.oid) as result_type
    FROM pg_catalog.pg_proc p
    LEFT JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname LIKE 'apply_call_action%'
  `;

  const { data, error } = await supabase.rpc('pg_query_v1' as any, { p_query: query });
  
  if (error) {
    // If no helper, try a raw query via postgrest if enabled (usually not for pg_proc)
    // We'll try to use a view if the user created one, or just guess.
    console.error('RPC Error:', error.message);
    
    // Guessing: let's try to call it with different parameter sets and see which one doesn't give 404
    const callTest = async (params) => {
        const { error } = await supabase.rpc('apply_call_action_v2', params);
        return error;
    };
    
    console.log('Testing signatures...');
    const e1 = await callTest({ p_call_id: '00000000-0000-0000-0000-000000000000' });
    console.log('Test 1 (v2 named):', e1?.message);
  } else {
    console.table(data);
  }
}

findFunction();
