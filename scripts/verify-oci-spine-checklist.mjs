import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const RETIRED_TABLE = ['marketing', '_signals'].join('');
const retiredFromRe = new RegExp(`from\\(['"]${RETIRED_TABLE}['"]\\)`);

const journalEnqueue = readFileSync(join(root, 'lib/oci/enqueue-oci-conversion-row.ts'), 'utf8');
if (journalEnqueue.includes('toExpectedValueCents')) {
  console.error('[verify-oci-spine] enqueue-oci-conversion-row must not use toExpectedValueCents for SSOT cents');
  process.exit(1);
}
if (retiredFromRe.test(journalEnqueue)) {
  console.error('[verify-oci-spine] enqueue-oci-conversion-row must not write retired audit table');
  process.exit(1);
}

const ssot = readFileSync(join(root, 'lib/oci/conversion-ssot.ts'), 'utf8');
if (!ssot.includes('OPSMANTIK_CONVERSION_NAMES')) {
  console.error('[verify-oci-spine] conversion-ssot.ts must derive from OPSMANTIK_CONVERSION_NAMES');
  process.exit(1);
}

console.log('[verify-oci-spine] OK');
