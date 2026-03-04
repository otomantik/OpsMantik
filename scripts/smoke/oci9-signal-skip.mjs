#!/usr/bin/env node
/**
 * OCI-9B Smoke: marketing_signals SKIPPED_NO_CLICK_ID migration and export path.
 * Source-inspection only (no DB).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '../..');
const exportPath = join(root, 'app/api/oci/google-ads-export/route.ts');
const migrationsDir = join(root, 'supabase/migrations');

let ok = 0;

// Check migration exists
const files = readdirSync(migrationsDir);
const mig = files.find((f) => f.includes('skipped_no_click_id') || f.includes('oci9_marketing'));
if (mig) {
  const migSrc = readFileSync(join(migrationsDir, mig), 'utf-8');
  if (migSrc.includes('SKIPPED_NO_CLICK_ID')) {
    console.log('✓ migration: SKIPPED_NO_CLICK_ID in dispatch_status');
    ok++;
  }
} else {
  console.error('✗ migration: no oci9 marketing_signals migration found');
}

const exportSrc = readFileSync(exportPath, 'utf-8');
if (exportSrc.includes("dispatch_status: 'SKIPPED_NO_CLICK_ID'")) {
  console.log('✓ export: updates dispatch_status to SKIPPED_NO_CLICK_ID');
  ok++;
} else {
  console.error('✗ export: missing SKIPPED_NO_CLICK_ID update');
}

if (exportSrc.includes('OCI_EXPORT_SIGNAL_SKIP_NO_CLICK_ID')) {
  console.log('✓ export: OCI_EXPORT_SIGNAL_SKIP_NO_CLICK_ID log');
  ok++;
} else {
  console.error('✗ export: missing skip log');
}

if (ok >= 2) {
  console.log('\nOCI-9B signal skip: PASS');
  process.exit(0);
} else {
  console.error(`\nOCI-9B signal skip: FAIL (${ok}/3)`);
  process.exit(1);
}
