import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../../.env.local') });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Missing ENV vars');
  process.exit(1);
}

const supabase = createClient(url, key);
const SITE_UUID = 'c644fff7-9d7a-440d-b9bf-99f3a0f86073';

async function main() {
  console.log('--- Resetting Muratcan AKU (UUID: ' + SITE_UUID + ') ---');
  
  const { data, error } = await supabase
    .from('offline_conversion_queue')
    .update({ 
      status: 'QUEUED', 
      claimed_at: null, 
      uploaded_at: null,
      last_error: null,
      provider_error_code: null
    })
    .eq('site_id', SITE_UUID)
    .neq('status', 'QUEUED')
    .select('id, status');

  if (error) {
    console.error('Update Error:', error);
  } else {
    console.log('Successfully reset ' + (data?.length || 0) + ' rows.');
    console.log('Reset IDs:', data?.map(r => r.id));
  }
  
  // Final verify
  const { data: final } = await supabase
    .from('offline_conversion_queue')
    .select('id, status')
    .eq('site_id', SITE_UUID)
    .eq('status', 'QUEUED');
    
  console.log('Current QUEUED count for Muratcan:', final?.length || 0);
}

main();
