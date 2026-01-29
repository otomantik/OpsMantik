#!/usr/bin/env node

/**
 * SECTOR BRAVO — Tank Tracker (Store & Forward) static proof.
 * Verifies ux-core.js contains the new outbox + processOutbox logic.
 *
 * Usage: node scripts/smoke/tank-tracker-proof.mjs
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '../..');
const uxCorePath = join(rootDir, 'public/ux-core.js');

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
  { name: 'getQueue()', pattern: /function\s+getQueue\s*\(/ },
  { name: 'saveQueue()', pattern: /function\s+saveQueue\s*\(/ },
  { name: 'addToOutbox()', pattern: /function\s+addToOutbox\s*\(/ },
  { name: 'processOutbox()', pattern: /function\s+processOutbox\s*\(/ },
  { name: 'response.ok check', pattern: /response\.ok/ },
  { name: 'TankTracker log', pattern: /\[TankTracker\]/ },
  { name: 'online event listener', pattern: /addEventListener\s*\(\s*['"]online['"]\s*,\s*processOutbox\s*\)/ },
  { name: 'beforeunload sendBeacon (Last Gasp)', pattern: /beforeunload[\s\S]{0,600}sendBeacon/ },
];

console.log(`\n${bold('SECTOR BRAVO — Tank Tracker (Store & Forward) proof')}`);
console.log(`${bold('========================================')}\n`);

if (!existsSync(uxCorePath)) {
  fail(`File not found: public/ux-core.js`);
  process.exit(1);
}

const content = readFileSync(uxCorePath, 'utf-8');
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
  console.log(`${GREEN}ux-core.js contains Store & Forward (outbox + processOutbox + response.ok)${RESET}\n`);
  process.exit(0);
} else {
  console.log(`${RED}${bold('❌ Tank Tracker static proof: FAIL')}${RESET}`);
  console.log(`${RED}Missing required patterns in public/ux-core.js${RESET}\n`);
  process.exit(1);
}
