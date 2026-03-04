#!/usr/bin/env node
/**
 * OCI-9A Smoke: Export route must have value guards (no || 0, explicit skip).
 * Source-inspection only (no DB/API).
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '../..');
const exportPath = join(root, 'app/api/oci/google-ads-export/route.ts');
const mapperPath = join(root, 'lib/providers/google_ads/mapper.ts');

const exportSrc = readFileSync(exportPath, 'utf-8');
const mapperSrc = readFileSync(mapperPath, 'utf-8');

let ok = 0;
if (mapperSrc.includes('INVALID_VALUE_CENTS')) {
  console.log('✓ mapper: INVALID_VALUE_CENTS guard present');
  ok++;
} else {
  console.error('✗ mapper: missing INVALID_VALUE_CENTS guard');
}

if (exportSrc.includes('NULL_CONVERSION_VALUE') || exportSrc.includes('NON_POSITIVE_CONVERSION_VALUE')) {
  console.log('✓ export: signal value skip reasons present');
  ok++;
} else {
  console.error('✗ export: missing NULL/NON_POSITIVE skip reasons');
}

if (exportSrc.includes('OCI_EXPORT_SIGNAL_SKIP_VALUE')) {
  console.log('✓ export: OCI_EXPORT_SIGNAL_SKIP_VALUE log marker');
  ok++;
} else {
  console.error('✗ export: missing OCI_EXPORT_SIGNAL_SKIP_VALUE');
}

if (ok === 3) {
  console.log('\nOCI-9A export guards: PASS');
  process.exit(0);
} else {
  console.error(`\nOCI-9A export guards: FAIL (${ok}/3)`);
  process.exit(1);
}
