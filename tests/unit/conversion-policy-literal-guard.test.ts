import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '.next' || name === '.git') continue;
      out.push(...walk(abs));
    } else {
      out.push(abs);
    }
  }
  return out;
}

test('PR-D guard: no duplicate stage-base literal maps outside approved SSOT modules/tests', () => {
  const files = [
    ...walk(join(ROOT, 'lib')),
    ...walk(join(ROOT, 'app')),
  ].filter((f) => /\.(ts|tsx|js|mjs)$/.test(f));

  const allow = new Set([
    'lib/oci/optimization-contract.ts',
    'lib/oci/marketing-signal-value-ssot.ts',
  ]);

  const offenders: string[] = [];
  for (const abs of files) {
    const rel = relative(ROOT, abs).replace(/\\/g, '/');
    if (allow.has(rel)) continue;
    const src = readFileSync(abs, 'utf8');
    const hasStageMap =
      /junk\s*:\s*0\.1/.test(src) &&
      /contacted\s*:\s*10/.test(src) &&
      /offered\s*:\s*50/.test(src) &&
      /won\s*:\s*100/.test(src);
    if (hasStageMap) offenders.push(rel);
  }

  assert.deepEqual(
    offenders,
    [],
    `stage-base literal map duplication outside SSOT is forbidden: ${offenders.join(', ')}`
  );
});
