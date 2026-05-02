#!/usr/bin/env node
/**
 * §23-style OCI spine merge checklist: SSOT conversion literals + seal queue boundary.
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

const names = readFileSync(join(root, 'lib/domain/mizan-mantik/conversion-names.ts'), 'utf8');
for (const m of must) {
  if (!names.includes(`'${m}'`)) {
    console.error(`[verify-oci-spine] conversion-names.ts missing ${m}`);
    process.exit(1);
  }
}

const gas = readFileSync(join(root, 'scripts/google-ads-oci/GoogleAdsScript.js'), 'utf8');
const tec = readFileSync(join(root, 'scripts/google-ads-oci/GoogleAdsScriptTecrubeliBakici.js'), 'utf8');
for (const m of must) {
  if (!gas.includes(`'${m}'`)) {
    console.error(`[verify-oci-spine] GoogleAdsScript.js missing ${m}`);
    process.exit(1);
  }
  if (!tec.includes(`'${m}'`)) {
    console.error(`[verify-oci-spine] GoogleAdsScriptTecrubeliBakici.js missing ${m}`);
    process.exit(1);
  }
}

const seal = readFileSync(join(root, 'lib/oci/enqueue-seal-conversion.ts'), 'utf8');
if (!/action:\s*OPSMANTIK_CONVERSION_NAMES\.won/.test(seal)) {
  console.error('[verify-oci-spine] enqueue-seal-conversion must set action to OPSMANTIK_CONVERSION_NAMES.won');
  process.exit(1);
}

const ssot = readFileSync(join(root, 'lib/domain/mizan-mantik/conversion-ssot.ts'), 'utf8');
if (!ssot.includes('OPSMANTIK_CONVERSION_NAMES')) {
  console.error('[verify-oci-spine] conversion-ssot.ts must derive from OPSMANTIK_CONVERSION_NAMES (single literal source)');
  process.exit(1);
}

const routerInsert = readFileSync(join(root, 'lib/domain/mizan-mantik/insert-marketing-signal.ts'), 'utf8');
if (routerInsert.includes('toExpectedValueCents')) {
  console.error('[verify-oci-spine] insert-marketing-signal must not use toExpectedValueCents — use loadMarketingSignalEconomics');
  process.exit(1);
}

console.log('[verify-oci-spine] OK');
