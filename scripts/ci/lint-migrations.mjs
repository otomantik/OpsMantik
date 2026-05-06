import fs from 'fs';
import path from 'path';

/**
 * Iron Protocol v3: Migration Linter
 * Blocks 'GRANT ALL' or risky grants to public roles.
 * Ignores comments and known legacy debt.
 */

const MIGRATIONS_DIR = './supabase/migrations';
const LEGACY_DEBT = [
  '20261223020200_oci_queue_transitions_ledger_and_claim_rpcs.sql',
];

const FORBIDDEN_PATTERNS = [
  {
    regex: /^[^--]*GRANT\s+ALL\s+.*TO\s+(anon|authenticated|public)/gim,
    message: 'GRANT ALL to anon/authenticated/public is forbidden. Use specific privileges.',
  },
  {
    regex: /^[^--]*GRANT\s+(INSERT|UPDATE|DELETE)\s+.*TO\s+(anon|authenticated|public)/gim,
    message: 'Write privileges to anon/authenticated/public are forbidden. Use SECURITY DEFINER RPCs.',
  },
];

const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql'));
let hasError = false;

console.log('🛡️  Running Iron Protocol Migration Linter...');

for (const file of files) {
  if (LEGACY_DEBT.includes(file)) {
    console.log(`⚠️  Skipping legacy debt: ${file}`);
    continue;
  }

  const content = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('--')) continue;

    for (const { regex, message } of FORBIDDEN_PATTERNS) {
      if (regex.test(line)) {
        console.error(`❌ Error in ${file} (line ${i + 1}): ${message}`);
        hasError = true;
      }
    }
  }
}

if (hasError) {
  console.log('\n❌ Iron Protocol verification failed.');
  process.exit(1);
} else {
  console.log('✅ All migrations pass Iron Protocol security standards.');
  process.exit(0);
}
