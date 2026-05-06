/**
 * Active architecture docs must not use ambiguous "100" + "score" without tying to contract terms.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

function isActiveDoc(src: string): boolean {
  if (!src.startsWith('---')) return false;
  const end = src.indexOf('\n---\n', 4);
  if (end < 0) return false;
  const fm = src.slice(0, end);
  return /status:\s*active/i.test(fm);
}

function activeArchitectureDocs(): string[] {
  const dir = join(ROOT, 'docs', 'architecture');
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.md')) continue;
    const rel = `docs/architecture/${name}`;
    const src = readFileSync(join(ROOT, rel), 'utf8');
    if (isActiveDoc(src)) files.push(rel);
  }
  return files;
}

/** Line has both 100 and score-like wording but lacks clarifying contract vocabulary. */
function isAmbiguousHundredScoreLine(line: string): boolean {
  if (!/\b100\b/.test(line)) return false;
  if (!/\b(scores?|scoring|puan|points?)\b/i.test(line)) return false;
  if (/removes ambiguity|non-interchangeable|FORBIDDEN|Three non-interchangeable/i.test(line)) return false;
  const clarify =
    /lead_score|stage_base|truth_closure|stage economic|major units|CLOSED_SYSTEM_SCORE_CONTRACT|operator|HOT|NORMAL|COLD|OpsMantik_|categorical|training/i.test(
      line
    );
  return !clarify;
}

test('CLOSED_SYSTEM_SCORE_CONTRACT defines the three explicit terms', () => {
  const src = readFileSync(join(ROOT, 'docs/architecture/CLOSED_SYSTEM_SCORE_CONTRACT.md'), 'utf8');
  assert.ok(isActiveDoc(src));
  assert.ok(src.includes('lead_score'));
  assert.ok(src.includes('stage_base_major'));
  assert.ok(src.includes('truth_closure_score'));
});

test('OCI_VALUE_ENGINES_SSOT links closed-system score contract', () => {
  const src = readFileSync(join(ROOT, 'docs/architecture/OCI_VALUE_ENGINES_SSOT.md'), 'utf8');
  assert.ok(isActiveDoc(src));
  assert.ok(src.includes('CLOSED_SYSTEM_SCORE_CONTRACT.md'));
});

test('active architecture docs: no ambiguous 100+score lines', () => {
  const ambiguous: { file: string; line: string }[] = [];
  for (const rel of activeArchitectureDocs()) {
    if (rel.endsWith('CLOSED_SYSTEM_SCORE_AUDIT_MATRIX.md')) continue;
    const src = readFileSync(join(ROOT, rel), 'utf8');
    const lines = src.split(/\r?\n/);
    for (const line of lines) {
      if (line.trim().startsWith('```')) continue;
      if (isAmbiguousHundredScoreLine(line)) ambiguous.push({ file: rel, line: line.trim() });
    }
  }
  assert.deepEqual(
    ambiguous,
    [],
    `Ambiguous lines (add lead_score / stage economic / truth_closure context or link contract): ${JSON.stringify(
      ambiguous,
      null,
      2
    )}`
  );
});

test('active architecture docs: use distinct vocabulary (lead_score, stage_base_major, truth_closure_score)', () => {
  const required = ['lead_score', 'stage_base_major', 'truth_closure_score'] as const;
  const mustContainAll: string[] = [
    'docs/architecture/CLOSED_SYSTEM_SCORE_CONTRACT.md',
    'docs/architecture/OCI_VALUE_ENGINES_SSOT.md',
    'docs/architecture/EXPORT_CONTRACT.md',
  ];
  for (const rel of mustContainAll) {
    const src = readFileSync(join(ROOT, rel), 'utf8');
    assert.ok(isActiveDoc(src), `${rel} must be status: active`);
    for (const term of required) {
      assert.ok(src.includes(term), `${rel} must include "${term}" (or link explicitly to CLOSED_SYSTEM — EXPORT may use only backticks)`);
    }
  }
});
