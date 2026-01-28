#!/usr/bin/env node
/**
 * Verify hotfix was applied successfully
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey);

async function main() {
  console.log('🔍 Verifying hotfix...\n');
  
  // Test 1: Check if get_recent_intents_v1 exists
  console.log('1️⃣  Testing get_recent_intents_v1...');
  const { data: sites } = await supabase.from('sites').select('id').limit(1);
  const siteId = sites?.[0]?.id;
  
  if (!siteId) {
    console.log('⚠️  No sites found, skipping RPC tests');
  } else {
    const { data: intents, error: intentsErr } = await supabase.rpc('get_recent_intents_v1', {
      p_site_id: siteId,
      p_since: null,
      p_minutes_lookback: 60,
      p_limit: 5,
      p_ads_only: true
    });
    
    if (intentsErr) {
      console.log(`   ❌ Error: ${intentsErr.message}`);
    } else {
      console.log(`   ✅ Success! Got ${Array.isArray(intents) ? intents.length : 0} intents`);
    }
  }
  
  // Test 2: Check if get_session_details exists
  console.log('\n2️⃣  Testing get_session_details...');
  const { data: sessions } = await supabase.from('sessions').select('id, site_id').limit(1);
  const session = sessions?.[0];
  
  if (!session) {
    console.log('   ⚠️  No sessions found, skipping test');
  } else {
    const { data: details, error: detailsErr } = await supabase.rpc('get_session_details', {
      p_site_id: session.site_id,
      p_session_id: session.id
    });
    
    if (detailsErr) {
      console.log(`   ❌ Error: ${detailsErr.message}`);
    } else {
      console.log(`   ✅ Success! Got ${Array.isArray(details) ? details.length : 0} session details`);
    }
  }
  
  // Test 3: Check if get_session_timeline exists
  console.log('\n3️⃣  Testing get_session_timeline...');
  if (!session) {
    console.log('   ⚠️  No sessions found, skipping test');
  } else {
    const { data: timeline, error: timelineErr } = await supabase.rpc('get_session_timeline', {
      p_site_id: session.site_id,
      p_session_id: session.id,
      p_limit: 10
    });
    
    if (timelineErr) {
      console.log(`   ❌ Error: ${timelineErr.message}`);
    } else {
      console.log(`   ✅ Success! Got ${Array.isArray(timeline) ? timeline.length : 0} timeline events`);
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('✅ Verification complete!');
  console.log('\n📝 If all tests passed, your dashboard should work now.');
  console.log('   Refresh your browser and check the Live Inbox.');
}

main().catch((e) => {
  console.error('\n❌ Verification failed:', e?.message || e);
  process.exit(1);
});
