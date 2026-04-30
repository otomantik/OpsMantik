
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkIntents() {
  console.log('Checking recent intents...');
  
  // Get last 20 calls
  const { data: calls, error } = await supabase
    .from('calls')
    .select('id, site_id, matched_session_id, status, created_at, phone_number, intent_stamp, version, reviewed_at')
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    console.error('Error fetching calls:', error);
    return;
  }

  console.table(calls.map(c => ({
    id: c.id.slice(0, 8),
    site: c.site_id.slice(0, 8),
    session: (c.matched_session_id || 'null').slice(0, 8),
    status: c.status,
    phone: c.phone_number,
    stamp: c.intent_stamp,
    version: c.version,
    reviewed: !!c.reviewed_at
  })));

  // Check for session duplicates
  const sessionCounts = {};
  calls.forEach(c => {
    if (c.matched_session_id) {
      sessionCounts[c.matched_session_id] = (sessionCounts[c.matched_session_id] || 0) + 1;
    }
  });

  const duplicates = Object.entries(sessionCounts).filter(([_, count]) => count > 1);
  if (duplicates.length > 0) {
    console.log('\nFound sessions with multiple calls:');
    duplicates.forEach(([sid, count]) => {
        console.log(`Session ${sid.slice(0,8)} has ${count} calls`);
    });
  } else {
    console.log('\nNo obvious session duplicates in the last 20 calls.');
  }
}

checkIntents();
