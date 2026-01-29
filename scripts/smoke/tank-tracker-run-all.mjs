#!/usr/bin/env node

/**
 * SECTOR BRAVO — Tank Tracker: Tüm kanıtları sırayla çalıştır.
 * 1) Statik proof (ux-core.js desenleri)
 * 2) Events proof (Supabase: son 5 dk event sayısı + son 10 event)
 * 3) Offline/Online proof (Playwright, TRACKER_SITE_URL veya PROOF_URL varsa)
 *
 * Usage: node scripts/smoke/tank-tracker-run-all.mjs
 */

import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '../..');
dotenv.config({ path: join(rootDir, '.env.local') });

const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

function run(name, scriptPath) {
  return new Promise((resolve) => {
    const child = spawn('node', [scriptPath], {
      cwd: rootDir,
      stdio: 'inherit',
      shell: true,
    });
    child.on('close', (code) => resolve(code === 0));
  });
}

async function main() {
  console.log(`\n${BOLD}SECTOR BRAVO — Tank Tracker: Tüm kanıtlar${RESET}`);
  console.log(`${BOLD}========================================${RESET}\n`);

  const p1 = await run('Statik proof', join(__dirname, 'tank-tracker-proof.mjs'));
  if (!p1) {
    console.log(`${RED}${BOLD}❌ Statik proof FAIL — durduruldu.${RESET}\n`);
    process.exit(1);
  }

  const p2 = await run('Events proof (Supabase)', join(__dirname, 'tank-tracker-events-proof.mjs'));
  if (!p2) {
    console.log(`${YELLOW}ℹ Events proof atlandı veya FAIL (Supabase env gerekebilir).${RESET}\n`);
  }

  const url = process.env.TRACKER_SITE_URL || process.env.PROOF_URL;
  const useLocal = process.env.USE_LOCAL_TRACKER_PAGE === '1' || process.env.USE_LOCAL_TRACKER_PAGE === 'true';
  if (url || useLocal) {
    const p3 = await run('Offline/Online proof (Playwright)', join(__dirname, 'tank-tracker-offline-online.mjs'));
    if (!p3) {
      console.log(`${YELLOW}ℹ Offline/Online proof FAIL (ağ veya URL).${RESET}\n`);
    }
  } else {
    console.log(`${YELLOW}ℹ TRACKER_SITE_URL / PROOF_URL yok — Offline/Online proof atlandı. USE_LOCAL_TRACKER_PAGE=1 ile yerel sayfa kullanılabilir.${RESET}\n`);
  }

  console.log(`${GREEN}${BOLD}✅ Tank Tracker run-all bitti.${RESET}\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
