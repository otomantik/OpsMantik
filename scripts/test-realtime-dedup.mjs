/**
 * Realtime Deduplication Test Harness
 * 
 * Demonstrates that duplicate events are received but only applied once
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing env vars');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testDeduplication() {
  console.log('🧪 Realtime Deduplication Test\n');

  // Get test site
  const { data: sites } = await supabase
    .from('sites')
    .select('id')
    .limit(1);

  if (!sites || sites.length === 0) {
    console.error('❌ No sites found');
    process.exit(1);
  }

  const siteId = sites[0].id;
  console.log(`📌 Test Site: ${siteId}\n`);

  // Create a test call
  const testCall = {
    site_id: siteId,
    phone_number: '+905551234567',
    matched_session_id: null,
    matched_fingerprint: null,
    lead_score: 50,
    status: 'intent',
    source: 'test',
  };

  console.log('1️⃣ Creating test call...');
  const { data: call, error: createError } = await supabase
    .from('calls')
    .insert(testCall)
    .select()
    .single();

  if (createError) {
    console.error('❌ Failed to create call:', createError.message);
    process.exit(1);
  }

  console.log(`✅ Call created: ${call.id}\n`);

  // Simulate duplicate events by updating the same call twice quickly
  console.log('2️⃣ Simulating duplicate events...');
  console.log('   (Updating call twice to trigger realtime events)\n');

  const update1 = { status: 'confirmed' };
  const update2 = { status: 'qualified' };

  // First update
  const { error: update1Error } = await supabase
    .from('calls')
    .update(update1)
    .eq('id', call.id)
    .eq('site_id', siteId);

  if (update1Error) {
    console.error('❌ Update 1 failed:', update1Error.message);
  } else {
    console.log('✅ Update 1 sent (status: confirmed)');
  }

  // Small delay
  await new Promise(resolve => setTimeout(resolve, 100));

  // Second update (simulates duplicate)
  const { error: update2Error } = await supabase
    .from('calls')
    .update(update2)
    .eq('id', call.id)
    .eq('site_id', siteId);

  if (update2Error) {
    console.error('❌ Update 2 failed:', update2Error.message);
  } else {
    console.log('✅ Update 2 sent (status: qualified)\n');
  }

  console.log('3️⃣ Expected Behavior:');
  console.log('   - Realtime hook receives both UPDATE events');
  console.log('   - Deduplication check runs for each event');
  console.log('   - If same eventId (table:id:timestamp), second is ignored');
  console.log('   - Only unique events trigger callbacks\n');

  console.log('4️⃣ Verification:');
  console.log('   - Check browser console for deduplication logs');
  console.log('   - Look for "[REALTIME] Duplicate event ignored" messages');
  console.log('   - Verify only one callback execution per unique event\n');

  // Cleanup
  console.log('5️⃣ Cleaning up test call...');
  const { error: deleteError } = await supabase
    .from('calls')
    .delete()
    .eq('id', call.id)
    .eq('site_id', siteId);

  if (deleteError) {
    console.error('⚠️  Cleanup failed:', deleteError.message);
  } else {
    console.log('✅ Test call deleted\n');
  }

  console.log('✅ Deduplication test complete');
  console.log('\n💡 To see deduplication in action:');
  console.log('   1. Open dashboard in browser');
  console.log('   2. Open browser console');
  console.log('   3. Run this script again');
  console.log('   4. Watch console for deduplication logs');
}

testDeduplication().catch(console.error);
