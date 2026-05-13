#!/usr/bin/env node
/**
 * §23-style OCI spine merge checklist: SSOT conversion literals + seal queue boundary.
 * Canonical fleet Apps Script literals are verified in `GoogleAdsScriptUniversal.js` only.
 * Run: node scripts/verify-oci-spine-checklist.mjs
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const root = process.cwd();
const must = [
  'OpsMantik_Contacted',
  'OpsMantik_Offered',
  'OpsMantik_Won',
  'OpsMantik_Junk_Exclusion',
];

const names = readFileSync(join(root, 'lib/oci/conversion-names.ts'), 'utf8');
for (const m of must) {
  if (!names.includes(`'${m}'`)) {
    console.error(`[verify-oci-spine] conversion-names.ts missing ${m}`);
    process.exit(1);
  }
}

const universal = readFileSync(join(root, 'scripts/google-ads-oci/GoogleAdsScriptUniversal.js'), 'utf8');
for (const m of must) {
  if (!universal.includes(`'${m}'`)) {
    console.error(`[verify-oci-spine] GoogleAdsScriptUniversal.js (canonical fleet script) missing ${m}`);
    process.exit(1);
  }
}

const seal = readFileSync(join(root, 'lib/oci/enqueue-seal-conversion.ts'), 'utf8');
if (!/action:\s*OPSMANTIK_CONVERSION_NAMES\.won/.test(seal)) {
  console.error('[verify-oci-spine] enqueue-seal-conversion must set action to OPSMANTIK_CONVERSION_NAMES.won');
  process.exit(1);
}

const ssot = readFileSync(join(root, 'lib/oci/conversion-ssot.ts'), 'utf8');
if (!ssot.includes('OPSMANTIK_CONVERSION_NAMES')) {
  console.error('[verify-oci-spine] conversion-ssot.ts must derive from OPSMANTIK_CONVERSION_NAMES (single literal source)');
  process.exit(1);
}

const upsertWriter = readFileSync(join(root, 'lib/oci/upsert-marketing-signal.ts'), 'utf8');
if (upsertWriter.includes('toExpectedValueCents')) {
  console.error('[verify-oci-spine] upsert-marketing-signal must not use toExpectedValueCents for SSOT cents');
  process.exit(1);
}

console.log('[verify-oci-spine] OK');
