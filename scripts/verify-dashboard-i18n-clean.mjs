#!/usr/bin/env node
/**
 * Verify dashboard i18n is clean:
 * - No imports from legacy lib/i18n/en.ts (strings)
 * - No forbidden hardcoded tokens
 *
 * Usage: node scripts/verify-dashboard-i18n-clean.mjs
 * Exit 0: pass. Exit 1: fail.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();

const FORBIDDEN_IMPORTS = [
  "from '@/lib/i18n/en'",
  'from "@/lib/i18n/en"',
  'lib/i18n/en',
];

const FORBIDDEN_TOKENS = [
  '"Traffic Sources"',
  "'Traffic Sources'",
  '"Revenue Projection"',
  "'Revenue Projection'",
  '"Conversion Pulse"',
  "'Conversion Pulse'",
  '>CAPTURE<',
  '>OCI ACTIVE<',
  '"Intent Qualification Queue"',
  "'Intent Qualification Queue'",
  'strings.',
];

function walkDir(dir, ext, out = []) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') {
      walkDir(full, ext, out);
    } else if (e.isFile() && (e.name.endsWith('.tsx') || e.name.endsWith('.ts'))) {
      out.push(full);
    }
  }
  return out;
}

function main() {
  const dirs = [
    join(ROOT, 'components', 'dashboard'),
    join(ROOT, 'app', 'dashboard'),
  ];
  const files = [];
  for (const d of dirs) {
    try {
      if (statSync(d).isDirectory()) {
        walkDir(d, null, files);
      }
    } catch (_) {}
  }
  const hooks = [
    join(ROOT, 'lib', 'hooks', 'use-dashboard-date-range.ts'),
    join(ROOT, 'lib', 'hooks', 'use-queue-controller.ts'),
  ];
  for (const f of hooks) {
    try {
      if (statSync(f).isFile()) files.push(f);
    } catch (_) {}
  }

  let failed = false;

  for (const file of files) {
    const content = readFileSync(file, 'utf-8');
    const rel = file.replace(ROOT + '/', '').replace(ROOT + '\\', '');

    for (const tok of FORBIDDEN_IMPORTS) {
      if (content.includes(tok)) {
        console.error(`[FAIL] ${rel}: legacy import`);
        failed = true;
      }
    }

    for (const tok of FORBIDDEN_TOKENS) {
      if (tok === 'strings.') {
        if (content.includes('strings.')) {
          console.error(`[FAIL] ${rel}: strings. usage`);
          failed = true;
        }
      } else if (content.includes(tok)) {
        console.error(`[FAIL] ${rel}: forbidden token ${tok}`);
        failed = true;
      }
    }
  }

  if (failed) {
    process.exit(1);
  }
  console.log('[OK] Dashboard i18n clean.');
}

main();
