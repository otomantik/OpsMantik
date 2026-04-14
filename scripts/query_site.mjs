import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://api.opsmantik.com';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function querySite() {
  const { data, error } = await supabase
    .from('sites')
    .select('id, oci_api_key')
    .ilike('name', '%Koç Oto%');

  if (data && data.length > 0) {
      console.log('SITE_ID_FOUND=' + data[0].id);
      console.log('API_KEY_FOUND=' + data[0].oci_api_key);
  }
}

querySite();
