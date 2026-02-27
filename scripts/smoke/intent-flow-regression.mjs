#!/usr/bin/env node
/**
 * Intent Flow Regression — Intent kaybı olmadığını kanıtlar.
 *
 * Akış: sync (202) → QStash → worker ingest → events + calls (intent)
 *
 * 1. Tank Tracker static proof (outbox, 15s timeout, sendBeacon)
 * 2. Transport backoff unit test
 * 3. P0 intent gate regression (sync → events → calls, consent_scopes gerekli)
 *
 * Usage:
 *   node scripts/smoke/intent-flow-regression.mjs
 *   node scripts/smoke/intent-flow-regression.mjs --skip-e2e   # Skip p0 (no DB)
 *
 * Env for p0 (e2e):
 *   NEXT_PUBLIC_SUPABASE_URL — must match production console (same project as Vercel)
 *   SUPABASE_SERVICE_ROLE_KEY
 *   SYNC_API_URL (default https://console.opsmantik.com/api/sync when not set)
 *   ORIGIN (default https://www.poyrazantika.com)
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '../..');
dotenv.config({ path: join(rootDir, '.env.local') });

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

function run(cmd, args, cwd = rootDir) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, stdio: 'inherit', shell: true });
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))));
    proc.on('error', reject);
  });
}

async function main() {
  const skipE2e = process.argv.includes('--skip-e2e');
  const hasSupabase = !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

  console.log(`\n${BOLD}Intent Flow Regression — Intent kaybı olmadığını kanıtla${RESET}`);
  console.log(`${BOLD}======================================================${RESET}\n`);

  // 1. Tank Tracker static proof
  console.log(`${BOLD}1. Tank Tracker (outbox + 15s timeout + Last Gasp)${RESET}`);
  try {
    await run('node', ['scripts/smoke/tank-tracker-proof.mjs']);
    console.log(`${GREEN}✓ Tank Tracker proof: PASS${RESET}\n`);
  } catch (e) {
    console.error(`${RED}✗ Tank Tracker proof: FAIL${RESET}`);
    process.exit(1);
  }

  // 2. Transport backoff
  console.log(`${BOLD}2. Transport backoff (retry logic)${RESET}`);
  try {
    await run('node', ['--import', 'tsx', '--test', 'tests/unit/tracker-transport-backoff.test.ts']);
    console.log(`${GREEN}✓ Transport backoff: PASS${RESET}\n`);
  } catch (e) {
    console.error(`${RED}✗ Transport backoff: FAIL${RESET}`);
    process.exit(1);
  }

  // 3. P0 intent gate (e2e: sync → events → calls)
  if (skipE2e || !hasSupabase) {
    if (!hasSupabase) {
      console.log(`${YELLOW}3. P0 intent gate: SKIP (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required)${RESET}`);
      console.log(`${YELLOW}   Run manually: node scripts/smoke/p0_intent_gate_regression.mjs${RESET}\n`);
    } else {
      console.log(`${YELLOW}3. P0 intent gate: SKIP (--skip-e2e)${RESET}\n`);
    }
  } else {
    console.log(`${BOLD}3. P0 intent gate (sync → events → calls)${RESET}`);
    if (!process.env.SYNC_API_URL) {
      process.env.SYNC_API_URL = 'https://console.opsmantik.com/api/sync';
      console.log(`${YELLOW}   SYNC_API_URL not set, using production${RESET}`);
    }
    try {
      await run('node', ['scripts/smoke/p0_intent_gate_regression.mjs']);
      console.log(`${GREEN}✓ P0 intent gate: PASS${RESET}\n`);
    } catch (e) {
      console.error(`${RED}✗ P0 intent gate: FAIL${RESET}`);
      process.exit(1);
    }
  }

  console.log(`${GREEN}${BOLD}✅ Intent Flow Regression: PASS${RESET}`);
  console.log(`${GREEN}Intent akışı bozulmamış (sync → event → call intent).${RESET}\n`);
}

main().catch((err) => {
  console.error(`${RED}❌ Regression failed: ${err?.message || err}${RESET}`);
  process.exit(1);
});
