/**
 * Architecture guards: closed-system score contract — no silent mixing of lead quality,
 * stage economics, and truth/closure concepts on the Google value path.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  CLOSED_SYSTEM_OPTIMIZATION_VALUE_LAW,
  LEAD_SCORE_GOOGLE_VALUE_MULTIPLIER_ENABLED,
} from '@/lib/oci/optimization-contract';

const ROOT = process.cwd();

const VALUE_MATH_FILES = [
  'lib/oci/marketing-signal-value-ssot.ts',
  'lib/oci/marketing-signal-hash.ts',
  'lib/oci/insert-marketing-signal.ts',
] as const;

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '.next') continue;
      out.push(...walkTsFiles(abs));
    } else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) {
      out.push(abs);
    }
  }
  return out;
}

test('LEAD_SCORE_GOOGLE_VALUE_MULTIPLIER_ENABLED stays false in production contract', () => {
  assert.equal(LEAD_SCORE_GOOGLE_VALUE_MULTIPLIER_ENABLED, false);
});

test('CLOSED_SYSTEM_OPTIMIZATION_VALUE_LAW remains stage_base_only_v1', () => {
  assert.equal(CLOSED_SYSTEM_OPTIMIZATION_VALUE_LAW, 'stage_base_only_v1');
});

test('marketing-signal value SSOT does not reference lead_score (Google cents path)', () => {
  const rel = 'lib/oci/marketing-signal-value-ssot.ts';
  const src = readFileSync(join(ROOT, rel), 'utf8');
  assert.match(src, /optimizationValue|OptimizationValueSnapshot/);
  assert.ok(!/\blead_score\b/.test(src), `${rel} must not mention lead_score on the export economics path`);
});

test('OCI value math files do not import or use CATEGORICAL_SCORES', () => {
  for (const rel of VALUE_MATH_FILES) {
    const src = readFileSync(join(ROOT, rel), 'utf8');
    assert.ok(
      !/\bCATEGORICAL_SCORES\b/.test(src),
      `${rel} must not reference CATEGORICAL_SCORES (lead quality only; see optimization-contract)`
    );
  }
});

test('lib/oci (excluding optimization-contract) does not reference CATEGORICAL_SCORES', () => {
  const ociDir = join(ROOT, 'lib', 'oci');
  const files = walkTsFiles(ociDir);
  const offenders: string[] = [];
  for (const abs of files) {
    const rel = relative(ROOT, abs).replace(/\\/g, '/');
    if (rel === 'lib/oci/optimization-contract.ts') continue;
    const src = readFileSync(abs, 'utf8');
    if (/\bCATEGORICAL_SCORES\b/.test(src)) offenders.push(rel);
  }
  assert.deepEqual(offenders, []);
});

test('truth_closure_score is not used on marketing-signal value SSOT path', () => {
  const rel = 'lib/oci/marketing-signal-value-ssot.ts';
  const src = readFileSync(join(ROOT, rel), 'utf8');
  assert.ok(!/\btruth_closure_score\b/.test(src), `${rel} must not reference truth_closure_score (audit-only)`);
});

test('docs: CLOSED_SYSTEM_SCORE_CONTRACT forbids equating lead 100 with won economic 100', () => {
  const src = readFileSync(join(ROOT, 'docs/architecture/CLOSED_SYSTEM_SCORE_CONTRACT.md'), 'utf8');
  assert.ok(src.includes('FORBIDDEN equivalences'));
  assert.ok(/lead_score.*100|won.*economic.*100/i.test(src));
});
