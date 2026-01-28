#!/usr/bin/env node
/**
 * Verification script: Check if get_recent_intents_v1 RPC exists in Supabase
 * 
 * Usage:
 *   node scripts/verify-rpc-exists.mjs
 * 
 * Requires:
 *   - SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in environment
 *   - Or reads from .env.local
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config } from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env.local if exists
try {
  const envPath = join(__dirname, '..', '.env.local');
  config({ path: envPath });
} catch (err) {
  // .env.local might not exist, continue
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing environment variables:');
  console.error('   Required: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL');
  console.error('   Required: SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY');
  console.error('\n💡 Tip: Create .env.local with these variables');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: false,
  },
});

const REQUIRED_RPCS = [
  'get_recent_intents_v1',
  'get_session_details',
  'get_session_timeline',
  'is_ads_session',
];

async function checkRpcExists(rpcName) {
  try {
    // Try to call the RPC with minimal params to see if it exists
    // We expect an error (auth/params), but NOT a 404
    const testParams = rpcName === 'get_recent_intents_v1' 
      ? { p_site_id: '00000000-0000-0000-0000-000000000000' }
      : rpcName === 'get_session_details'
      ? { p_site_id: '00000000-0000-0000-0000-000000000000', p_session_id: '00000000-0000-0000-0000-000000000000' }
      : rpcName === 'get_session_timeline'
      ? { p_site_id: '00000000-0000-0000-0000-000000000000', p_session_id: '00000000-0000-0000-0000-000000000000' }
      : rpcName === 'is_ads_session'
      ? {} // This one is a helper, might not be directly callable
      : {};

    const { data, error } = await supabase.rpc(rpcName, testParams);
    
    // If we get a 404, the function doesn't exist
    if (error) {
      if (error.code === 'PGRST116' || error.message?.includes('404') || error.message?.includes('not found')) {
        return { exists: false, error: '404 Not Found - Function does not exist' };
      }
      // Other errors (auth, params) are OK - function exists
      return { exists: true, error: null, note: `Function exists (got expected error: ${error.message?.substring(0, 50)})` };
    }
    
    // If we got data or no error, function exists
    return { exists: true, error: null };
  } catch (err) {
    if (err.message?.includes('404') || err.message?.includes('not found')) {
      return { exists: false, error: '404 Not Found' };
    }
    return { exists: false, error: err.message || 'Unknown error' };
  }
}

async function main() {
  console.log('🔍 Verifying Supabase RPC functions...\n');
  console.log(`📍 Supabase URL: ${SUPABASE_URL.replace(/\/rest\/v1.*$/, '')}\n`);

  const results = [];
  for (const rpcName of REQUIRED_RPCS) {
    const result = await checkRpcExists(rpcName);
    results.push({ name: rpcName, ...result });
    
    const icon = result.exists ? '✅' : '❌';
    const status = result.exists ? 'EXISTS' : 'MISSING';
    console.log(`${icon} ${rpcName.padEnd(30)} ${status}`);
    if (result.note) {
      console.log(`   ℹ️  ${result.note}`);
    }
    if (result.error && !result.exists) {
      console.log(`   ⚠️  ${result.error}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  
  const missing = results.filter(r => !r.exists);
  if (missing.length === 0) {
    console.log('\n✅ ALL RPCs EXIST - Database migrations are applied!');
    console.log('\n💡 Next steps:');
    console.log('   1. Hard refresh dashboard (Ctrl+Shift+R)');
    console.log('   2. Check Network tab - 404s should be gone');
    process.exit(0);
  } else {
    console.log(`\n❌ ${missing.length} RPC(s) MISSING - Migrations need to be applied`);
    console.log('\n📋 Missing RPCs:');
    missing.forEach(r => console.log(`   - ${r.name}`));
    console.log('\n🔧 Fix: Run migration push:');
    console.log('   supabase db push');
    console.log('\n📖 See: MIGRATION_PUSH_INSTRUCTIONS.md for details');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('\n💥 Script error:', err.message);
  process.exit(1);
});
