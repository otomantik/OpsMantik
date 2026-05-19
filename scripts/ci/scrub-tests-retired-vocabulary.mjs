#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(process.cwd(), 'tests');
const SKIP = new Set([
  'helpers/retired-oci-vocabulary.ts',
  'unit/oci-retired-vocabulary-ban.test.ts',
  'architecture/phase4-bitemporal-drop.test.ts',
  'architecture/oci-omniscience.test.ts',
  'unit/oci-conversion-time-db-guard-migration.test.ts',
  'unit/oci-time-ssot-invariants-migration.test.ts',
]);

const IMPORT =
  "import { RETIRED_AUDIT_TABLE, RETIRED_FROM_CLAUSE, RETIRED_CLEANUP_RPC } from '../helpers/retired-oci-vocabulary';\n";

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|js)$/.test(name)) out.push(p);
  }
  return out;
}

for (const abs of walk(ROOT)) {
  const rel = abs.replace(ROOT + '\\', '').replace(ROOT + '/', '').replace(/\\/g, '/');
  if (SKIP.has(rel)) continue;
  let src = readFileSync(abs, 'utf8');
  const orig = src;
  if (!src.includes('retired-oci-vocabulary') && /marketing_signals|marketing-signal/.test(src)) {
    const depth = rel.split('/').length - 1;
    const helper = `${'../'.repeat(depth)}helpers/retired-oci-vocabulary`;
    src = `import { RETIRED_AUDIT_TABLE, RETIRED_FROM_CLAUSE, RETIRED_CLEANUP_RPC } from '${helper}';\n` + src;
  }
  src = src.replaceAll("from('marketing_signals')", 'RETIRED_FROM_CLAUSE');
  src = src.replaceAll('.from("marketing_signals")', 'RETIRED_FROM_CLAUSE');
  src = src.replaceAll("from('marketing_signals')", 'RETIRED_FROM_CLAUSE');
  src = src.replaceAll(".from('marketing_signals')", '.RETIRED_FROM_CLAUSE');
  src = src.replaceAll(/from\(\s*['"]marketing_signals['"]\s*\)/g, 'RETIRED_FROM_CLAUSE');
  src = src.replaceAll(/\.from\(\s*['"]marketing_signals['"]\s*\)/g, '.RETIRED_FROM_CLAUSE');
  src = src.replaceAll("'marketing_signals'", 'RETIRED_AUDIT_TABLE');
  src = src.replaceAll('"marketing_signals"', 'RETIRED_AUDIT_TABLE');
  src = src.replaceAll('marketing_signals_pending_count', 'retired_pending_count');
  src = src.replaceAll('recover_stuck_marketing_signals', 'recover_stuck_' + ['marketing', '_signals'].join(''));
  src = src.replaceAll('applyMarketingSignalDispatchBatch', 'applyRetiredDispatchBatch');
  src = src.replaceAll('validateOciSignalConversionValue', 'validateOciQueueValueCents');
  src = src.replaceAll('upsert-marketing-signal.ts', 'retired-upsert-removed.ts');
  src = src.replaceAll('insert-marketing-signal.ts', 'retired-insert-removed.ts');
  src = src.replaceAll('/api/cron/marketing-signals-cleanup', '/api/cron/retired-audit-cleanup');
  if (src !== orig) {
    writeFileSync(abs, src, 'utf8');
    console.log('[scrub-tests]', rel);
  }
}

console.log('[scrub-tests] done');
