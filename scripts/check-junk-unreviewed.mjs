
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkJunkUnreviewed() {
  console.log('Checking for junk/cancelled calls with NULL reviewed_at...');
  
  const { data, error } = await supabase
    .from('calls')
    .select('id, status, created_at, reviewed_at')
    .in('status', ['junk', 'cancelled'])
    .is('reviewed_at', null)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    console.error('Error:', error);
    return;
  }

  if (data.length === 0) {
    console.log('No junk/cancelled calls with NULL reviewed_at found.');
    return;
  }

  console.log(`Found ${data.length} records:`);
  console.table(data.map(d => ({
    id: d.id.slice(0, 8),
    status: d.status,
    created: d.created_at,
    reviewed: d.reviewed_at
  })));
}

checkJunkUnreviewed();
