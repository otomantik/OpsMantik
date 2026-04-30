
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkDedupe() {
  console.log('Checking for duplicate canonical_intent_key groups...');
  
  // Manual check
  const { data: all } = await supabase
    .from('calls')
    .select('id, canonical_intent_key, status, created_at')
    .order('created_at', { ascending: false })
    .limit(100);

  const groups = {};
  all.forEach(c => {
    if (c.canonical_intent_key) {
      groups[c.canonical_intent_key] = groups[c.canonical_intent_key] || [];
      groups[c.canonical_intent_key].push(c);
    }
  });

  const duplicates = Object.entries(groups).filter(([_, list]) => list.length > 1);
  
  if (duplicates.length === 0) {
    console.log('No duplicates found in the last 100 calls.');
    return;
  }

  duplicates.forEach(([key, list]) => {
    console.log(`\nDuplicate Group: ${key}`);
    list.forEach(c => {
      console.log(`  - ID: ${c.id}, Status: ${c.status}, Created: ${c.created_at}`);
    });
  });
}

checkDedupe();
