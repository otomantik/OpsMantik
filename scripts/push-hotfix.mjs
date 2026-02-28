#!/usr/bin/env node
/**
 * Push hotfix SQL to Supabase
 * Reads hotfix_missing_rpcs.sql and executes it via service role
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey);

async function main() {
  console.log('🚀 Pushing hotfix to Supabase...\n');
  
  // Read SQL file
  const sqlPath = join(__dirname, '../hotfix_missing_rpcs.sql');
  const sql = readFileSync(sqlPath, 'utf-8');
  
  console.log('📄 SQL file loaded, executing...\n');
  
  // Execute SQL via Supabase RPC
  // Note: We'll use the postgres connection directly via supabase-js
  const { data, error } = await supabase.rpc('exec', { sql });
  
  if (error) {
    // If exec RPC doesn't exist, we'll try another approach
    console.log('⚠️  exec RPC not available, trying direct query...\n');
    
    // Split SQL by statements and execute one by one
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s && !s.startsWith('--') && s !== 'BEGIN' && s !== 'COMMIT');
    
    let successCount = 0;
    let failCount = 0;
    
    for (const statement of statements) {
      if (!statement) continue;
      
      try {
        const { error: stmtError } = await supabase.rpc('query', { sql: statement });
        if (stmtError) {
          console.error(`❌ Error executing statement: ${stmtError.message}`);
          console.error(`   Statement: ${statement.substring(0, 100)}...`);
          failCount++;
        } else {
          successCount++;
        }
      } catch (e) {
        console.error(`❌ Exception: ${e.message}`);
        failCount++;
      }
    }
    
    console.log(`\n✅ Completed: ${successCount} statements successful, ${failCount} failed`);
    
    if (failCount > 0) {
      console.log('\n⚠️  Some statements failed. Please run the SQL manually in Supabase SQL Editor:');
      const sqlUrl = supabaseUrl.includes('.supabase.co')
        ? supabaseUrl.replace('.supabase.co', '.supabase.com') + '/sql'
        : 'https://supabase.com/dashboard/project/jktpvfbmuoqrtuwbjpwl/sql';
      console.log(`   ${sqlUrl}`);
      console.log('\n   Copy the contents of hotfix_missing_rpcs.sql and paste it there.');
      process.exit(1);
    }
  } else {
    console.log('✅ Hotfix applied successfully!');
  }
  
  // Verify functions exist
  console.log('\n🔍 Verifying functions...\n');
  
  const functionsToCheck = [
    'get_recent_intents_v1',
    'get_session_details', 
    'get_session_timeline',
    'is_ads_session'
  ];
  
  for (const funcName of functionsToCheck) {
    const { data: funcData, error: funcError } = await supabase
      .from('pg_proc')
      .select('proname')
      .eq('proname', funcName)
      .single();
    
    if (funcError || !funcData) {
      console.log(`❌ Function ${funcName} not found`);
    } else {
      console.log(`✅ Function ${funcName} exists`);
    }
  }
  
  console.log('\n✅ Hotfix push complete!');
  console.log('\n📝 Next steps:');
  console.log('   1. Refresh your dashboard');
  console.log('   2. Check browser console for any errors');
  console.log('   3. If you still see 404 errors, run the SQL manually in Supabase SQL Editor');
}

main().catch((e) => {
  console.error('❌ FAIL:', e?.message || e);
  console.log('\n⚠️  Please run the SQL manually in Supabase SQL Editor:');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const sqlUrl = url?.includes('.supabase.co')
    ? url.replace('.supabase.co', '.supabase.com') + '/sql'
    : 'https://supabase.com/dashboard/project/jktpvfbmuoqrtuwbjpwl/sql';
  console.log(`   ${sqlUrl}`);
  console.log('\n   Copy the contents of hotfix_missing_rpcs.sql and paste it there.');
  process.exit(1);
});
