/**
 * Smoke Test: PRO Dashboard Migration v2.2 - RPC Contract
 * 
 * Tests:
 * 1. get_dashboard_stats with date_from/date_to
 * 2. get_dashboard_timeline
 * 3. get_dashboard_intents
 * 4. get_dashboard_breakdown
 * 5. 6-month range validation
 * 6. Heartbeat exclusion
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load env
dotenv.config({ path: join(__dirname, '../../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
// Use service role key for smoke test to bypass RLS
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  console.error('   Note: Service role key recommended for smoke tests to bypass RLS');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Test site ID (use first available site or provide via env)
const TEST_SITE_ID = process.env.TEST_SITE_ID;

async function testRPC(name, fn) {
  try {
    console.log(`\n🧪 Testing ${name}...`);
    const result = await fn();
    console.log(`✅ ${name}: PASS`);
    return { name, pass: true, result };
  } catch (error) {
    console.error(`❌ ${name}: FAIL`);
    console.error(`   Error: ${error.message}`);
    return { name, pass: false, error: error.message };
  }
}

async function main() {
  console.log('🚀 PRO Dashboard Migration v2.2 - RPC Contract Smoke Test\n');
  console.log(`Supabase URL: ${supabaseUrl}`);
  console.log(`Test Site ID: ${TEST_SITE_ID || 'Will fetch first site'}\n`);

  let siteId = TEST_SITE_ID;

  // Get site ID if not provided
  if (!siteId) {
    const { data: sites, error } = await supabase
      .from('sites')
      .select('id')
      .limit(1);

    if (error) {
      console.error('❌ Failed to fetch test site:', error.message);
      console.error('   Hint: Set TEST_SITE_ID env variable or ensure SUPABASE_SERVICE_ROLE_KEY is set');
      process.exit(1);
    }
    
    if (!sites || sites.length === 0) {
      console.error('❌ No sites found in database');
      console.error('   Hint: Create a test site first using: npm run create-test-site');
      process.exit(1);
    }
    
    siteId = sites[0].id;
    console.log(`📌 Using site: ${siteId}\n`);
  }

  // Date range: last 7 days
  const dateTo = new Date();
  const dateFrom = new Date();
  dateFrom.setDate(dateFrom.getDate() - 7);

  const results = [];

  // Test 1: get_dashboard_stats
  results.push(await testRPC('get_dashboard_stats', async () => {
    const { data, error } = await supabase.rpc('get_dashboard_stats', {
      p_site_id: siteId,
      p_date_from: dateFrom.toISOString(),
      p_date_to: dateTo.toISOString(),
      p_ads_only: true
    });

    if (error) throw error;
    if (!data) throw new Error('No data returned');
    if (!data.site_id) throw new Error('Missing site_id');
    if (!data.date_from) throw new Error('Missing date_from');
    if (!data.date_to) throw new Error('Missing date_to');
    
    return data;
  }));

  // Test 2: get_dashboard_timeline
  results.push(await testRPC('get_dashboard_timeline', async () => {
    const { data, error } = await supabase.rpc('get_dashboard_timeline', {
      p_site_id: siteId,
      p_date_from: dateFrom.toISOString(),
      p_date_to: dateTo.toISOString(),
      p_granularity: 'auto',
      p_ads_only: true
    });

    if (error) throw error;
    if (!Array.isArray(data)) throw new Error('Expected array');
    
    return { count: data.length };
  }));

  // Test 3: get_dashboard_intents
  results.push(await testRPC('get_dashboard_intents', async () => {
    const { data, error } = await supabase.rpc('get_dashboard_intents', {
      p_site_id: siteId,
      p_date_from: dateFrom.toISOString(),
      p_date_to: dateTo.toISOString(),
      p_status: null,
      p_search: null,
      p_ads_only: true
    });

    if (error) throw error;
    if (!Array.isArray(data)) throw new Error('Expected array');
    
    return { count: data.length };
  }));

  // Test 4: get_dashboard_breakdown (source)
  results.push(await testRPC('get_dashboard_breakdown (source)', async () => {
    const { data, error } = await supabase.rpc('get_dashboard_breakdown', {
      p_site_id: siteId,
      p_date_from: dateFrom.toISOString(),
      p_date_to: dateTo.toISOString(),
      p_dimension: 'source',
      p_ads_only: true
    });

    if (error) throw error;
    if (!Array.isArray(data)) throw new Error('Expected array');
    
    return { count: data.length };
  }));

  // Test 5: get_dashboard_breakdown (device)
  results.push(await testRPC('get_dashboard_breakdown (device)', async () => {
    const { data, error } = await supabase.rpc('get_dashboard_breakdown', {
      p_site_id: siteId,
      p_date_from: dateFrom.toISOString(),
      p_date_to: dateTo.toISOString(),
      p_dimension: 'device',
      p_ads_only: true
    });

    if (error) throw error;
    if (!Array.isArray(data)) throw new Error('Expected array');
    
    return { count: data.length };
  }));

  // Test 6: get_dashboard_breakdown (city)
  results.push(await testRPC('get_dashboard_breakdown (city)', async () => {
    const { data, error } = await supabase.rpc('get_dashboard_breakdown', {
      p_site_id: siteId,
      p_date_from: dateFrom.toISOString(),
      p_date_to: dateTo.toISOString(),
      p_dimension: 'city',
      p_ads_only: true
    });

    if (error) throw error;
    if (!Array.isArray(data)) throw new Error('Expected array');
    
    return { count: data.length };
  }));

  // Test 7: 6-month range validation
  results.push(await testRPC('6-month range validation', async () => {
    const invalidDateFrom = new Date();
    invalidDateFrom.setDate(invalidDateFrom.getDate() - 200); // > 6 months

    const { error } = await supabase.rpc('get_dashboard_stats', {
      p_site_id: siteId,
      p_date_from: invalidDateFrom.toISOString(),
      p_date_to: dateTo.toISOString(),
      p_ads_only: true
    });

    if (!error) throw new Error('Expected error for range > 6 months');
    if (!error.message.includes('exceeds maximum')) throw new Error('Expected range validation error');
    
    return { validation: 'working' };
  }));

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 Test Summary');
  console.log('='.repeat(60));
  
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📈 Total: ${results.length}`);
  
  if (failed > 0) {
    console.log('\n❌ Some tests failed. See errors above.');
    process.exit(1);
  } else {
    console.log('\n✅ All tests passed!');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
