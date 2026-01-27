#!/usr/bin/env node

/**
 * Transport Proof Script - Verify sendBeacon + keepalive in tracking scripts
 * 
 * Checks:
 * 1. sendBeacon exists in both ux-core.js and assets/core.js
 * 2. keepalive: true exists in both files
 * 3. queueEvent and drainQueue functions exist
 * 
 * Usage: node scripts/smoke/track-transport-proof.mjs
 */

import { readFileSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '../..');

// ANSI color codes
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

function info(msg) {
  console.log(`${YELLOW}ℹ${RESET} ${msg}`);
}

function bold(msg) {
  return `${BOLD}${msg}${RESET}`;
}

// Files to check
const files = [
  {
    path: join(rootDir, 'public/ux-core.js'),
    name: 'ux-core.js',
  },
  {
    path: join(rootDir, 'public/assets/core.js'),
    name: 'assets/core.js',
  },
];

// Required patterns
const requiredPatterns = [
  {
    name: 'navigator.sendBeacon',
    pattern: /navigator\.sendBeacon/,
    critical: true,
  },
  {
    name: 'keepalive: true',
    pattern: /keepalive:\s*true/,
    critical: true,
  },
  {
    name: 'queueEvent function',
    pattern: /function\s+queueEvent\s*\(/,
    critical: true,
  },
  {
    name: 'drainQueue function',
    pattern: /function\s+drainQueue\s*\(/,
    critical: true,
  },
  {
    name: 'opsmantik_evtq_v1 queue key',
    pattern: /opsmantik_evtq_v1/,
    critical: true,
  },
  {
    name: 'Blob application/json',
    pattern: /new\s+Blob\(\[.*?\],\s*\{\s*type:\s*['"]application\/json['"]\s*\}\)/,
    critical: true,
  },
];

// Optional patterns (nice to have)
const optionalPatterns = [
  {
    name: 'Debug logging ([track])',
    pattern: /\[track\]/,
  },
  {
    name: 'opsmantik_debug switch',
    pattern: /localStorage\.getItem\(['"]opsmantik_debug['"]\)/,
  },
];

console.log(`\n${bold('🔬 TRANSPORT PROOF SCRIPT')}`);
console.log(`${bold('========================================')}\n`);

let allPassed = true;
const results = [];

// Check each file
for (const file of files) {
  console.log(`${bold(`Checking ${file.name}:`)}`);
  
  let content;
  let stats;
  
  try {
    content = readFileSync(file.path, 'utf-8');
    stats = statSync(file.path);
  } catch (err) {
    fail(`File not found: ${file.path}`);
    allPassed = false;
    results.push({ file: file.name, passed: false, reason: 'File not found' });
    continue;
  }
  
  info(`  File size: ${stats.size} bytes, modified: ${stats.mtime.toISOString()}`);
  
  let filePassed = true;
  const fileResults = [];
  
  // Check required patterns
  for (const pattern of requiredPatterns) {
    const found = pattern.pattern.test(content);
    
    if (found) {
      pass(`  ${pattern.name}`);
      fileResults.push({ pattern: pattern.name, found: true });
    } else {
      fail(`  ${pattern.name} - MISSING`);
      fileResults.push({ pattern: pattern.name, found: false });
      if (pattern.critical) {
        filePassed = false;
        allPassed = false;
      }
    }
  }
  
  // Check optional patterns
  console.log(`  ${YELLOW}Optional:${RESET}`);
  for (const pattern of optionalPatterns) {
    const found = pattern.pattern.test(content);
    
    if (found) {
      pass(`    ${pattern.name}`);
      fileResults.push({ pattern: pattern.name, found: true, optional: true });
    } else {
      info(`    ${pattern.name} - not found (ok)`);
      fileResults.push({ pattern: pattern.name, found: false, optional: true });
    }
  }
  
  results.push({ file: file.name, passed: filePassed, checks: fileResults });
  console.log('');
}

// Summary
console.log(`${bold('========================================')}`);
console.log(`${bold('SUMMARY:')}\n`);

for (const result of results) {
  if (result.passed) {
    pass(`${result.file}: PASS`);
  } else {
    fail(`${result.file}: FAIL (${result.reason || 'missing required patterns'})`);
  }
}

console.log('');

if (allPassed) {
  console.log(`${GREEN}${bold('✅ TRANSPORT PROOF: PASS')}${RESET}`);
  console.log(`${GREEN}sendBeacon + keepalive + offline queue present in both files${RESET}\n`);
  process.exit(0);
} else {
  console.log(`${RED}${bold('❌ TRANSPORT PROOF: FAIL')}${RESET}`);
  console.log(`${RED}Required patterns missing from tracking scripts${RESET}\n`);
  process.exit(1);
}
