
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function listFuncs() {
  const { data, error } = await supabase.rpc('get_functions_v1', { p_schema: 'public' });
  if (error) {
    console.error('Error:', error);
    return;
  }
  console.log(data.filter(f => f.name.includes('apply_call')));
}

listFuncs();
