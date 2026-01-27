/**
 * Performance Analysis: RPC EXPLAIN (ANALYZE, BUFFERS)
 * 
 * Runs EXPLAIN for each dashboard RPC with Today and Last 30 days scenarios
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { writeFileSync } from 'fs';

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

async function runExplain(rpcName, params, scenario) {
  // Build EXPLAIN query
  const paramList = Object.keys(params).map(k => `$${Object.keys(params).indexOf(k) + 1}::${getParamType(k)}`).join(', ');
  const paramValues = Object.values(params);
  
  // For RPCs, we need to call the function and explain it
  // Note: Supabase doesn't support EXPLAIN on RPCs directly, so we'll need to analyze the underlying queries
  // Instead, we'll query pg_stat_statements or use a workaround
  
  const explainQuery = `
    EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
    SELECT * FROM ${rpcName}(${paramList})
  `;
  
  try {
    // Use raw SQL query via Supabase
    const { data, error } = await supabase.rpc('exec_sql', {
      sql: explainQuery,
      params: paramValues
    });
    
    if (error) {
      // Fallback: Try direct query
      console.log(`\n📊 ${rpcName} - ${scenario}`);
      console.log(`   Query: ${rpcName}(${JSON.stringify(params)})`);
      console.log(`   ⚠️  Cannot run EXPLAIN via RPC (Supabase limitation)`);
      console.log(`   💡 Run EXPLAIN manually in Supabase SQL editor`);
      return { rpcName, scenario, params, explain: 'MANUAL_REQUIRED' };
    }
    
    return { rpcName, scenario, params, explain: data };
  } catch (err) {
    console.log(`\n📊 ${rpcName} - ${scenario}`);
    console.log(`   ⚠️  Error: ${err.message}`);
    return { rpcName, scenario, params, explain: null, error: err.message };
  }
}

function getParamType(paramName) {
  if (paramName.includes('site_id')) return 'uuid';
  if (paramName.includes('date')) return 'timestamptz';
  if (paramName.includes('dimension') || paramName.includes('granularity') || paramName.includes('status') || paramName.includes('search')) return 'text';
  return 'text';
}

async function main() {
  console.log('🔍 RPC Performance Analysis - v2.2\n');

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
  const now = new Date();
  
  // Scenario 1: Today
  const todayFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayTo = now;
  
  // Scenario 2: Last 30 days
  const thirtyDaysFrom = new Date(now);
  thirtyDaysFrom.setDate(thirtyDaysFrom.getDate() - 30);
  const thirtyDaysTo = now;

  const results = [];

  // 1. get_dashboard_stats
  console.log('Testing get_dashboard_stats...');
  results.push(await runExplain('get_dashboard_stats', {
    p_site_id: siteId,
    p_date_from: todayFrom.toISOString(),
    p_date_to: todayTo.toISOString()
  }, 'Today'));
  
  results.push(await runExplain('get_dashboard_stats', {
    p_site_id: siteId,
    p_date_from: thirtyDaysFrom.toISOString(),
    p_date_to: thirtyDaysTo.toISOString()
  }, 'Last 30 Days'));

  // 2. get_dashboard_timeline
  console.log('Testing get_dashboard_timeline...');
  results.push(await runExplain('get_dashboard_timeline', {
    p_site_id: siteId,
    p_date_from: todayFrom.toISOString(),
    p_date_to: todayTo.toISOString(),
    p_granularity: 'auto'
  }, 'Today'));
  
  results.push(await runExplain('get_dashboard_timeline', {
    p_site_id: siteId,
    p_date_from: thirtyDaysFrom.toISOString(),
    p_date_to: thirtyDaysTo.toISOString(),
    p_granularity: 'auto'
  }, 'Last 30 Days'));

  // 3. get_dashboard_intents
  console.log('Testing get_dashboard_intents...');
  results.push(await runExplain('get_dashboard_intents', {
    p_site_id: siteId,
    p_date_from: todayFrom.toISOString(),
    p_date_to: todayTo.toISOString(),
    p_status: null,
    p_search: null
  }, 'Today'));
  
  results.push(await runExplain('get_dashboard_intents', {
    p_site_id: siteId,
    p_date_from: thirtyDaysFrom.toISOString(),
    p_date_to: thirtyDaysTo.toISOString(),
    p_status: null,
    p_search: null
  }, 'Last 30 Days'));

  // 4. get_dashboard_breakdown (source)
  console.log('Testing get_dashboard_breakdown (source)...');
  results.push(await runExplain('get_dashboard_breakdown', {
    p_site_id: siteId,
    p_date_from: todayFrom.toISOString(),
    p_date_to: todayTo.toISOString(),
    p_dimension: 'source'
  }, 'Today'));
  
  results.push(await runExplain('get_dashboard_breakdown', {
    p_site_id: siteId,
    p_date_from: thirtyDaysFrom.toISOString(),
    p_date_to: thirtyDaysTo.toISOString(),
    p_dimension: 'source'
  }, 'Last 30 Days'));

  // Write results
  const outputPath = join(__dirname, '../docs/WAR_ROOM/REPORTS/RPC_PERF_PROOF_V2_2.md');
  
  let report = `# RPC Performance Proof v2.2\n\n**Date**: ${new Date().toISOString()}\n**Test Site**: ${siteId}\n\n`;
  report += `## Note\n\n`;
  report += `Supabase RPCs cannot be EXPLAINed directly via client. `;
  report += `Run these EXPLAIN queries manually in Supabase SQL editor:\n\n`;
  
  results.forEach(({ rpcName, scenario, params }) => {
    const paramList = Object.entries(params)
      .map(([k, v]) => `${k} => ${typeof v === 'string' ? `'${v}'` : v}`)
      .join(', ');
    
    report += `### ${rpcName} - ${scenario}\n\n`;
    report += `\`\`\`sql\n`;
    report += `EXPLAIN (ANALYZE, BUFFERS, VERBOSE)\n`;
    report += `SELECT * FROM ${rpcName}(${paramList});\n`;
    report += `\`\`\`\n\n`;
  });
  
  writeFileSync(outputPath, report);
  console.log(`\n✅ Report written to: ${outputPath}`);
  console.log(`\n💡 Run EXPLAIN queries manually in Supabase SQL editor`);
}

main().catch(console.error);
