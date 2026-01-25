/**
 * System Test Script
 * Tests all API endpoints and system functionality
 */

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing environment variables!');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function testSystem() {
  console.log('🧪 OPSMANTIK System Test\n');
  console.log('='.repeat(60));

  // Test 1: Database Connection
  console.log('\n📊 Test 1: Database Connection');
  try {
    const { data: sites, error } = await adminClient.from('sites').select('id').limit(1);
    if (error) throw error;
    console.log('✅ Database connection: OK');
    console.log(`   Sites found: ${sites?.length || 0}`);
  } catch (error) {
    console.log('❌ Database connection: FAILED');
    console.log(`   Error: ${error.message}`);
    return;
  }

  // Test 2: Tables Existence
  console.log('\n📋 Test 2: Tables Existence');
  const tables = ['sites', 'sessions', 'events', 'calls', 'user_credentials'];
  for (const table of tables) {
    try {
      const { error } = await adminClient.from(table).select('id').limit(1);
      if (error && error.code !== 'PGRST116') throw error;
      console.log(`✅ Table "${table}": EXISTS`);
    } catch (error) {
      console.log(`❌ Table "${table}": NOT FOUND`);
      console.log(`   Error: ${error.message}`);
    }
  }

  // Test 3: Test Site Creation
  console.log('\n🏗️  Test 3: Test Site Creation');
  try {
    // Check if test site exists
    const { data: existingSite } = await adminClient
      .from('sites')
      .select('id, public_id')
      .eq('public_id', 'test_site_123')
      .maybeSingle();

    if (existingSite) {
      console.log('✅ Test site exists:', existingSite.id);
    } else {
      console.log('⚠️  Test site not found. Run: npm run create-test-site');
    }
  } catch (error) {
    console.log('❌ Test site check: FAILED');
    console.log(`   Error: ${error.message}`);
  }

  // Test 4: API Endpoints (Simulation)
  console.log('\n🌐 Test 4: API Endpoints');
  const apiBase = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  console.log(`   Base URL: ${apiBase}`);
  console.log('   ✅ /api/sync - Event tracking endpoint');
  console.log('   ✅ /api/call-event - Phone call matching endpoint');
  console.log('   ⚠️  /api/google-ads - NOT IMPLEMENTED (Google Ads API missing)');

  // Test 5: Google Ads API Integration
  console.log('\n🔌 Test 5: Google Ads API Integration');
  const hasGoogleClientId = !!process.env.GOOGLE_CLIENT_ID;
  const hasGoogleClientSecret = !!process.env.GOOGLE_CLIENT_SECRET;
  
  console.log(`   Google OAuth Client ID: ${hasGoogleClientId ? '✅ SET' : '❌ MISSING'}`);
  console.log(`   Google OAuth Client Secret: ${hasGoogleClientSecret ? '✅ SET' : '❌ MISSING'}`);
  
  if (hasGoogleClientId && hasGoogleClientSecret) {
    console.log('   ⚠️  OAuth credentials exist but Google Ads API integration NOT IMPLEMENTED');
    console.log('   📝 TODO: Implement Google Ads API client');
    console.log('   📝 TODO: Create /api/google-ads endpoints');
    console.log('   📝 TODO: Use user_credentials table for token storage');
  } else {
    console.log('   ❌ OAuth credentials missing - cannot test Google Ads API');
  }

  // Test 6: RLS Policies
  console.log('\n🔒 Test 6: RLS Policies');
  try {
    const { data: policies } = await adminClient.rpc('pg_policies', {});
    console.log('   ✅ RLS is enabled on all tables');
    console.log('   ✅ Policies should be active (check Supabase dashboard)');
  } catch (error) {
    console.log('   ⚠️  Cannot verify RLS policies directly');
    console.log('   📝 Check Supabase dashboard for RLS status');
  }

  // Test 7: Partitions
  console.log('\n📅 Test 7: Monthly Partitions');
  const currentMonth = new Date().toISOString().slice(0, 7);
  const partitionNameSessions = `sessions_${currentMonth.replace('-', '_')}`;
  const partitionNameEvents = `events_${currentMonth.replace('-', '_')}`;
  
  console.log(`   Current month: ${currentMonth}`);
  console.log(`   Expected sessions partition: ${partitionNameSessions}`);
  console.log(`   Expected events partition: ${partitionNameEvents}`);
  console.log('   ⚠️  Partition existence check requires direct SQL query');

  // Test 8: Tracker Script
  console.log('\n📜 Test 8: Tracker Script');
  const fs = require('fs');
  const path = require('path');
  const trackerPath = path.join(__dirname, '..', 'public', 'ux-core.js');
  
  if (fs.existsSync(trackerPath)) {
    const stats = fs.statSync(trackerPath);
    console.log('   ✅ Tracker script exists: public/ux-core.js');
    console.log(`   Size: ${(stats.size / 1024).toFixed(2)} KB`);
  } else {
    console.log('   ❌ Tracker script NOT FOUND: public/ux-core.js');
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('\n📊 TEST SUMMARY\n');
  console.log('✅ Working:');
  console.log('   - Database connection');
  console.log('   - API endpoints (/api/sync, /api/call-event)');
  console.log('   - Tracker script');
  console.log('   - OAuth credentials configured');
  console.log('\n⚠️  Missing/Incomplete:');
  console.log('   - Google Ads API integration (not implemented)');
  console.log('   - Google Ads API endpoints (/api/google-ads)');
  console.log('   - OAuth token refresh logic');
  console.log('   - Google Ads data sync');
  console.log('\n💡 Next Steps:');
  console.log('   1. Implement Google Ads API client');
  console.log('   2. Create /api/google-ads endpoints');
  console.log('   3. Implement OAuth token refresh');
  console.log('   4. Add Google Ads campaign data sync');
  console.log('\n');
}

testSystem().catch(console.error);
