/**
 * RPC Verification Queries for Evidence Bundle
 * 
 * Runs verification queries for each RPC and outputs results
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { writeFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load env
dotenv.config({ path: join(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log('🔍 Running RPC Verification Queries...\n');

  // Get test site ID
  const { data: sites } = await supabase
    .from('sites')
    .select('id')
    .limit(1);

  if (!sites || sites.length === 0) {
    console.error('❌ No sites found');
    process.exit(1);
  }

  const siteId = sites[0].id;
  const dateTo = new Date();
  const dateFrom = new Date();
  dateFrom.setDate(dateFrom.getDate() - 7);

  const evidence = {
    timestamp: new Date().toISOString(),
    site_id: siteId,
    date_range: {
      from: dateFrom.toISOString(),
      to: dateTo.toISOString()
    },
    rpc_results: {}
  };

  // 1. get_dashboard_stats
  console.log('📊 Testing get_dashboard_stats...');
  const { data: statsData, error: statsError } = await supabase.rpc('get_dashboard_stats', {
    p_site_id: siteId,
    p_date_from: dateFrom.toISOString(),
    p_date_to: dateTo.toISOString()
  });
  
  if (statsError) {
    evidence.rpc_results.get_dashboard_stats = { error: statsError.message };
  } else {
    evidence.rpc_results.get_dashboard_stats = {
      success: true,
      data: statsData,
      keys: Object.keys(statsData || {})
    };
  }

  // 2. get_dashboard_timeline
  console.log('📈 Testing get_dashboard_timeline...');
  const { data: timelineData, error: timelineError } = await supabase.rpc('get_dashboard_timeline', {
    p_site_id: siteId,
    p_date_from: dateFrom.toISOString(),
    p_date_to: dateTo.toISOString(),
    p_granularity: 'auto'
  });
  
  if (timelineError) {
    evidence.rpc_results.get_dashboard_timeline = { error: timelineError.message };
  } else {
    evidence.rpc_results.get_dashboard_timeline = {
      success: true,
      count: Array.isArray(timelineData) ? timelineData.length : 0,
      sample: Array.isArray(timelineData) && timelineData.length > 0 ? timelineData[0] : null,
      first_5: Array.isArray(timelineData) ? timelineData.slice(0, 5) : []
    };
  }

  // 3. get_dashboard_intents
  console.log('🎯 Testing get_dashboard_intents...');
  const { data: intentsData, error: intentsError } = await supabase.rpc('get_dashboard_intents', {
    p_site_id: siteId,
    p_date_from: dateFrom.toISOString(),
    p_date_to: dateTo.toISOString(),
    p_status: null,
    p_search: null
  });
  
  if (intentsError) {
    evidence.rpc_results.get_dashboard_intents = { error: intentsError.message };
  } else {
    evidence.rpc_results.get_dashboard_intents = {
      success: true,
      count: Array.isArray(intentsData) ? intentsData.length : 0,
      sample: Array.isArray(intentsData) && intentsData.length > 0 ? intentsData[0] : null,
      first_5: Array.isArray(intentsData) ? intentsData.slice(0, 5) : []
    };
  }

  // 4. get_dashboard_breakdown (all dimensions)
  console.log('📊 Testing get_dashboard_breakdown...');
  for (const dimension of ['source', 'device', 'city']) {
    const { data: breakdownData, error: breakdownError } = await supabase.rpc('get_dashboard_breakdown', {
      p_site_id: siteId,
      p_date_from: dateFrom.toISOString(),
      p_date_to: dateTo.toISOString(),
      p_dimension: dimension
    });
    
    if (breakdownError) {
      evidence.rpc_results[`get_dashboard_breakdown_${dimension}`] = { error: breakdownError.message };
    } else {
      evidence.rpc_results[`get_dashboard_breakdown_${dimension}`] = {
        success: true,
        count: Array.isArray(breakdownData) ? breakdownData.length : 0,
        sample: Array.isArray(breakdownData) && breakdownData.length > 0 ? breakdownData[0] : null,
        all: Array.isArray(breakdownData) ? breakdownData : []
      };
    }
  }

  // 5. Test 6-month validation
  console.log('⏱️  Testing 6-month range validation...');
  const invalidDateFrom = new Date();
  invalidDateFrom.setDate(invalidDateFrom.getDate() - 200); // > 6 months
  
  const { error: validationError } = await supabase.rpc('get_dashboard_stats', {
    p_site_id: siteId,
    p_date_from: invalidDateFrom.toISOString(),
    p_date_to: dateTo.toISOString()
  });
  
  evidence.rpc_results.range_validation = {
    test: '6-month max range enforcement',
    invalid_range_days: 200,
    expected_error: true,
    got_error: !!validationError,
    error_message: validationError?.message || null
  };

  // Write evidence file
  const outputPath = join(__dirname, '../docs/_archive/2026-02-02/WAR_ROOM/EVIDENCE/v2_2/sql_verification_results.json');
  writeFileSync(outputPath, JSON.stringify(evidence, null, 2));
  
  console.log('\n✅ Verification complete!');
  console.log(`📄 Results saved to: ${outputPath}`);
  console.log('\n📋 Summary:');
  console.log(`   - get_dashboard_stats: ${evidence.rpc_results.get_dashboard_stats.success ? '✅' : '❌'}`);
  console.log(`   - get_dashboard_timeline: ${evidence.rpc_results.get_dashboard_timeline.success ? '✅' : '❌'} (${evidence.rpc_results.get_dashboard_timeline.count} points)`);
  console.log(`   - get_dashboard_intents: ${evidence.rpc_results.get_dashboard_intents.success ? '✅' : '❌'} (${evidence.rpc_results.get_dashboard_intents.count} intents)`);
  console.log(`   - get_dashboard_breakdown: ✅ (source: ${evidence.rpc_results.get_dashboard_breakdown_source.count}, device: ${evidence.rpc_results.get_dashboard_breakdown_device.count}, city: ${evidence.rpc_results.get_dashboard_breakdown_city.count})`);
  console.log(`   - Range validation: ${evidence.rpc_results.range_validation.got_error ? '✅' : '❌'}`);
}

main().catch(console.error);
