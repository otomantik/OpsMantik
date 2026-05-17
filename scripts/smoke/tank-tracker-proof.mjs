#!/usr/bin/env node

/**
 * SECTOR BRAVO — Tank Tracker (Store & Forward) static proof.
 * Verifies public/assets/core.js contains Store & Forward (outbox) logic.
 *
 * Usage: node scripts/smoke/tank-tracker-proof.mjs
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '../..');
const uxCorePath = join(rootDir, 'public/ux-core.js');
const corePath = join(rootDir, 'public/assets/core.js');

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

function pass(msg) {
  console.log(`${GREEN}✓${RESET} ${msg}`);
}
function fail(msg) {
  console.log(`${RED}✗${RESET} ${msg}`);
}
function bold(msg) {
  return `${BOLD}${msg}${RESET}`;
}

const requiredPatterns = [
  { name: 'QUEUE_KEY opsmantik_outbox_v2', pattern: /opsmantik_outbox_v2/ },
  { name: 'getQueue()', pattern: /function\s+getQueue\s*\(|function\s+A\s*\(/ },
  { name: 'saveQueue()', pattern: /function\s+saveQueue\s*\(|function\s+v\s*\(/ },
  { name: 'addToOutbox()', pattern: /function\s+addToOutbox\s*\(|function\s+D\s*\(/ },
  { name: 'processOutbox()', pattern: /function\s+processOutbox\s*\(|function\s+l\s*\(/ },
  { name: 'response.ok check', pattern: /response\.ok/ },
  { name: 'TankTracker log', pattern: /\[TankTracker\]/ },
  { name: 'online event listener', pattern: /addEventListener\s*\(\s*['"]online['"]\s*,\s*processOutbox\s*\)|addEventListener\s*\(\s*['"]online['"]\s*,\s*l\s*\)/ },
  { name: 'beforeunload sendBeacon (Last Gasp)', pattern: /beforeunload[\s\S]{0,2000}sendBeacon|(beforeunload[\s\S]{0,300}lastGaspFlush)/ },
  { name: 'sessionStorage fallback (Hardness Map)', pattern: /sessionStorage|getStorage|_s\s*\(/ },
  { name: 'SYNC_TIMEOUT_MS >= 15s (intent loss prevention)', pattern: /SYNC_TIMEOUT_MS\s*=\s*15e3|15e3.*AbortController|abort.*DOMException/ },
];

console.log(`\n${bold('SECTOR BRAVO — Tank Tracker (Store & Forward) proof')}`);
console.log(`${bold('========================================')}\n`);

if (!existsSync(corePath)) {
  fail('File not found: public/assets/core.js');
  process.exit(1);
}
if (!existsSync(uxCorePath)) {
  fail('File not found: public/ux-core.js (back-compat shim)');
  process.exit(1);
}
const shim = readFileSync(uxCorePath, 'utf-8');
if (shim.includes('/api/call-event') || shim.includes('opsmantik_outbox')) {
  fail('public/ux-core.js must be shim-only (no embedded tracker bundle)');
  process.exit(1);
}
pass('public/ux-core.js is shim-only');

// Check canonical production bundle (core.js) as primary
const content = readFileSync(corePath, 'utf-8');
let passed = 0;
let failed = 0;

for (const { name, pattern } of requiredPatterns) {
  if (pattern.test(content)) {
    pass(name);
    passed++;
  } else {
    fail(name);
    failed++;
  }
}

console.log(`\n${bold('----------------------------------------')}`);
console.log(`${bold(`Result: ${passed} passed, ${failed} failed`)}\n`);

if (failed === 0) {
  console.log(`${GREEN}${bold('✅ Tank Tracker static proof: PASS')}${RESET}`);
  console.log(`${GREEN}assets/core.js contains Store & Forward (outbox + processOutbox + response.ok)${RESET}\n`);
  process.exit(0);
} else {
  console.log(`${RED}${bold('❌ Tank Tracker static proof: FAIL')}${RESET}`);
  console.log(`${RED}Missing required patterns in public/assets/core.js${RESET}\n`);
  process.exit(1);
}
