#!/usr/bin/env node
/**
 * Run Call Match Integrity Diagnostics
 * 
 * Executes SQL diagnostics queries against Supabase database
 * Requires: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config } from 'dotenv';

// Load .env.local
config({ path: '.env.local' });

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing required environment variables:');
  console.error('   NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL');
  console.error('   SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

// Colors for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function runQuery(name, sql) {
  log(`\n📊 ${name}`, 'cyan');
  log('─'.repeat(60), 'reset');
  
  try {
    const { data, error } = await supabase.rpc('exec_sql', { sql_query: sql });
    
    if (error) {
      // Try direct query if RPC doesn't exist
      const { data: directData, error: directError } = await supabase
        .from('_dummy')
        .select('*')
        .limit(0);
      
      if (directError) {
        // Use REST API for raw SQL
        const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
          },
          body: JSON.stringify({ sql_query: sql })
        });
        
        if (!response.ok) {
          log(`   ⚠️  Note: Direct SQL execution not available.`, 'yellow');
          log(`   Copy the SQL below and run in Supabase SQL Editor:`, 'yellow');
          log(`\n${sql}\n`, 'reset');
          return;
        }
      }
      
      log(`   ❌ Error: ${error.message}`, 'red');
      log(`   Copy the SQL below and run in Supabase SQL Editor:`, 'yellow');
      log(`\n${sql}\n`, 'reset');
      return;
    }
    
    if (data && data.length > 0) {
      console.table(data);
    } else {
      log('   ✅ Query executed (no results)', 'green');
    }
  } catch (err) {
    log(`   ⚠️  Cannot execute directly. Copy SQL to Supabase SQL Editor:`, 'yellow');
    log(`\n${sql}\n`, 'reset');
  }
}

async function main() {
  log('🚀 Call Match Integrity Diagnostics', 'blue');
  log(`   Database: ${SUPABASE_URL}`, 'reset');
  
  // Read SQL diagnostics file
  const sqlPath = join(__dirname, '../docs/WAR_ROOM/REPORTS/SQL_DIAGNOSTICS.sql');
  const sqlContent = readFileSync(sqlPath, 'utf8');
  
  // Split by query blocks (separated by -- =====)
  const queries = sqlContent.split(/-- =+=\n/).filter(q => q.trim());
  
  // Extract individual queries
  const queryBlocks = [];
  let currentQuery = '';
  let currentName = '';
  
  for (const line of sqlContent.split('\n')) {
    if (line.startsWith('-- Query') || line.startsWith('-- Verification')) {
      if (currentQuery.trim()) {
        queryBlocks.push({ name: currentName, sql: currentQuery.trim() });
      }
      currentQuery = '';
      currentName = line.replace('--', '').trim();
    } else if (line.startsWith('-- =')) {
      // Section separator
      if (currentQuery.trim()) {
        queryBlocks.push({ name: currentName, sql: currentQuery.trim() });
      }
      currentQuery = '';
      currentName = '';
    } else if (!line.startsWith('--') || line.trim() === '') {
      currentQuery += line + '\n';
    }
  }
  
  if (currentQuery.trim()) {
    queryBlocks.push({ name: currentName, sql: currentQuery.trim() });
  }
  
  // If parsing failed, try simpler approach
  if (queryBlocks.length === 0) {
    // Split by semicolons and filter
    const statements = sqlContent
      .split(';')
      .map(s => s.trim())
      .filter(s => s && !s.startsWith('--') && s.length > 50);
    
    queryBlocks.push(
      { name: 'Query 1: Impossible Matches Summary', sql: statements[0] + ';' },
      { name: 'Query 1: Impossible Matches Details', sql: statements[1] + ';' },
      { name: 'Query 2: Match Method Distribution', sql: statements[2] + ';' },
      { name: 'Query 3: Fingerprint Leakage Summary', sql: statements[3] + ';' },
      { name: 'Query 3: Fingerprint Leakage Details', sql: statements[4] + ';' }
    );
  }
  
  log(`\n📋 Found ${queryBlocks.length} queries to run\n`, 'blue');
  
  // Run each query
  for (const { name, sql } of queryBlocks) {
    if (sql && sql.trim()) {
      await runQuery(name, sql);
    }
  }
  
  log('\n✅ Diagnostics complete!', 'green');
  log('   Note: Some queries may need to be run manually in Supabase SQL Editor', 'yellow');
}

main().catch(err => {
  log(`\n❌ Error: ${err.message}`, 'red');
  if (err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});
