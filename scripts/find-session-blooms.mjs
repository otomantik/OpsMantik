
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function findSessionBlooms() {
  console.log('Searching for sessions with multiple pending intents...');
  
  // Manual check
  const { data: all } = await supabase
    .from('calls')
    .select('id, matched_session_id, status, created_at, phone_number')
    .eq('status', 'intent')
    .order('created_at', { ascending: false })
    .limit(200);

  const sessionMap = {};
  all.forEach(c => {
    if (c.matched_session_id) {
        sessionMap[c.matched_session_id] = sessionMap[c.matched_session_id] || [];
        sessionMap[c.matched_session_id].push(c);
    }
  });

  const blooms = Object.entries(sessionMap).filter(([_, list]) => list.length > 1);
  
  if (blooms.length === 0) {
    console.log('No session blooms found in the last 200 pending intents.');
    return;
  }

  console.log(`Found ${blooms.length} session blooms:`);
  blooms.forEach(([sid, list]) => {
    console.log(`\nSession ${sid.slice(0,8)} has ${list.length} intents:`);
    list.forEach(c => {
      console.log(`  - ID: ${c.id}, Phone: ${c.phone_number}, Created: ${c.created_at}`);
    });
  });
}

findSessionBlooms();
