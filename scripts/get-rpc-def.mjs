
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function getDef() {
  const { data, error } = await supabase.rpc('get_function_definition_v1', { 
    p_schema: 'public', 
    p_name: 'apply_call_action_v2' 
  });
  
  if (error) {
    // Try another helper if exists
    console.error('Error:', error);
    
    // Manual query via pg_proc
    const { data: proc, error: procErr } = await supabase
      .from('_pg_proc_view') // If we have a view for it
      .select('prosrc')
      .eq('proname', 'apply_call_action_v2')
      .maybeSingle();
      
    if (procErr) {
        console.error('Proc error:', procErr);
    } else {
        console.log(proc?.prosrc);
    }
  } else {
    console.log(data);
  }
}

getDef();
