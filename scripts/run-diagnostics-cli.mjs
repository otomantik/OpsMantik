#!/usr/bin/env node
/**
 * Run Call Match Integrity Diagnostics via Supabase CLI
 * 
 * Uses Supabase CLI to execute SQL queries against remote database
 * Requires: Supabase CLI linked to project
 */

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

function runQueryViaCLI(name, sql) {
  log(`\n📊 ${name}`, 'cyan');
  log('─'.repeat(60), 'reset');
  
  try {
    // Write SQL to temp file
    const tempFile = join(__dirname, '../.temp-diagnostic.sql');
    require('fs').writeFileSync(tempFile, sql, 'utf8');
    
    // Execute via Supabase CLI
    const result = execSync(
      `supabase db execute --file "${tempFile}" --linked`,
      { encoding: 'utf8', stdio: 'pipe' }
    );
    
    if (result) {
      log(result, 'reset');
    } else {
      log('   ✅ Query executed', 'green');
    }
    
    // Cleanup
    try {
      require('fs').unlinkSync(tempFile);
    } catch (e) {
      // Ignore cleanup errors
    }
  } catch (err) {
    log(`   ⚠️  CLI execution failed: ${err.message}`, 'yellow');
    log(`   Copy the SQL below and run in Supabase SQL Editor:`, 'yellow');
    log(`\n${sql}\n`, 'reset');
  }
}

async function main() {
  log('🚀 Call Match Integrity Diagnostics (via Supabase CLI)', 'blue');
  
  // Check if Supabase CLI is linked
  try {
    const status = execSync('supabase status --linked', { encoding: 'utf8', stdio: 'pipe' });
    log('   ✅ Supabase project linked', 'green');
  } catch (err) {
    log('   ⚠️  Supabase project not linked. Run: supabase link', 'yellow');
    log('   Or copy SQL queries manually from SQL_DIAGNOSTICS.sql', 'yellow');
    process.exit(1);
  }
  
  // Read SQL diagnostics file
  const sqlPath = join(__dirname, '../docs/WAR_ROOM/REPORTS/SQL_DIAGNOSTICS.sql');
  const sqlContent = readFileSync(sqlPath, 'utf8');
  
  // Extract queries (simplified - split by major sections)
  const queries = [
    {
      name: 'Query 1: Impossible Matches Summary',
      sql: sqlContent.match(/WITH session_first_events AS[\s\S]*?FROM impossible_matches;/)?.[0] || ''
    },
    {
      name: 'Query 1: Impossible Matches Details (Top 10)',
      sql: sqlContent.match(/-- Detailed list[\s\S]*?LIMIT 10;/)?.[0]?.replace(/-- Detailed list[\s\S]*?WITH/, 'WITH') || ''
    },
    {
      name: 'Query 2: Match Method Distribution',
      sql: sqlContent.match(/-- =+=\s*Query 2[\s\S]*?ORDER BY call_count DESC;/)?.[0]?.replace(/--[^\n]*\n/g, '') || ''
    },
    {
      name: 'Query 3: Fingerprint Leakage Summary',
      sql: sqlContent.match(/-- =+=\s*Query 3[\s\S]*?FROM fingerprint_matches;/)?.[0]?.replace(/--[^\n]*\n/g, '') || ''
    },
    {
      name: 'Query 3: Fingerprint Leakage Details (Top 10)',
      sql: sqlContent.match(/-- Top 10 leakage[\s\S]*?LIMIT 10;/)?.[0]?.replace(/--[^\n]*\n/g, '') || ''
    }
  ].filter(q => q.sql.trim());
  
  if (queries.length === 0) {
    // Fallback: use raw SQL file
    log('\n⚠️  Could not parse queries. Using direct file execution...', 'yellow');
    try {
      execSync(`supabase db execute --file "${sqlPath}" --linked`, { encoding: 'utf8', stdio: 'inherit' });
    } catch (err) {
      log(`\n❌ Error: ${err.message}`, 'red');
      log('   Please run SQL queries manually in Supabase SQL Editor', 'yellow');
      process.exit(1);
    }
  } else {
    log(`\n📋 Found ${queries.length} queries to run\n`, 'blue');
    
    // Run each query
    for (const { name, sql } of queries) {
      if (sql && sql.trim()) {
        runQueryViaCLI(name, sql.trim());
      }
    }
  }
  
  log('\n✅ Diagnostics complete!', 'green');
}

main().catch(err => {
  log(`\n❌ Error: ${err.message}`, 'red');
  if (err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});
