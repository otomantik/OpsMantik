/**
 * Runtime TypeScript must not reference marketing_signals (table retired).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SCAN_ROOTS = ['lib', 'app', 'components'] as const;
const FORBIDDEN = /marketing_signals|marketing-signal|MarketingSignal|upsertMarketingSignal|insertMarketingSignal/;

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '.next') continue;
      out.push(...walkTsFiles(abs));
    } else if (/\.(ts|tsx|mjs)$/.test(name)) {
      out.push(abs);
    }
  }
  return out;
}

test('runtime sources do not reference marketing_signals artifacts', () => {
  const offenders: string[] = [];
  for (const root of SCAN_ROOTS) {
    const absRoot = join(ROOT, root);
    const files = root.endsWith('.mjs') ? [absRoot] : walkTsFiles(absRoot);
    for (const file of files) {
      const rel = relative(ROOT, file).replace(/\\/g, '/');
      if (rel.includes('tests/')) continue;
      const src = readFileSync(file, 'utf8');
      if (FORBIDDEN.test(src)) offenders.push(rel);
    }
  }
  assert.equal(offenders.length, 0, `marketing_signals residue in:\n${offenders.join('\n')}`);
});

test('final drop migration removes marketing_signals table and cleanup RPC', () => {
  const sql = readFileSync(
    join(ROOT, 'supabase', 'migrations', '20261320120000_marketing_signals_drop_final_v1.sql'),
    'utf8'
  );
  assert.match(sql, /DROP TABLE IF EXISTS public\.marketing_signals/i);
  assert.match(sql, /cleanup_marketing_signals_batch/i);
  assert.match(sql, /apply_marketing_signal_dispatch_batch_v1/i);
});

test('night-maintenance does not call marketing_signals retention RPC', () => {
  const src = readFileSync(join(ROOT, 'app', 'api', 'cron', 'night-maintenance', 'route.ts'), 'utf8');
  assert.ok(!src.includes('cleanup_marketing_signals_batch'));
});
