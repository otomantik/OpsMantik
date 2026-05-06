import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { normalizeEvidenceArtifact } from '../../scripts/release/evidence-contracts.mjs';

const ROOT = process.cwd();

test('release evidence contract exposes stable reason codes', () => {
  const src = readFileSync(join(ROOT, 'scripts/release/evidence-contracts.mjs'), 'utf8');
  for (const code of [
    'MISSING_ENV',
    'MISSING_SQL_PACK',
    'INVALID_SQL_CONTRACT',
    'DB_NOT_REQUIRED_FOR_MODE',
    'DB_UNAVAILABLE',
    'DB_QUERY_FAILED',
    'RED_METRIC',
    'PARSER_ERROR',
    'UNKNOWN_MODE',
    'PASS_WITH_WARNINGS',
  ]) {
    assert.ok(src.includes(code), `reason code ${code} must exist`);
  }
});

test('release evidence reports UNKNOWN_MODE deterministically', () => {
  const run = spawnSync('node scripts/release/collect-gate-evidence.mjs --mode=invalid-mode --output tmp/evidence-unknown.md', {
    cwd: ROOT,
    shell: true,
    encoding: 'utf8',
    env: { ...process.env, EVIDENCE_TEST_FAST: '1' },
  });
  assert.notEqual(run.status, 0);
  const out = readFileSync(join(ROOT, 'tmp/evidence-unknown.md'), 'utf8');
  assert.ok(out.includes('UNKNOWN_MODE'));
});

test('normalized evidence artifact is replay-stable', () => {
  const base = {
    metadata: { generated_at: 'a', git_commit: 'b', mode: 'static' },
    checks: [{ name: 'x', status: 'PASS', started_at: 't1', duration_ms: 1 }],
    overall_status: 'PASS',
  };
  const next = {
    metadata: { generated_at: 'z', git_commit: 'y', mode: 'static' },
    checks: [{ name: 'x', status: 'PASS', started_at: 't2', duration_ms: 99 }],
    overall_status: 'PASS',
  };
  assert.equal(normalizeEvidenceArtifact(base), normalizeEvidenceArtifact(next));
});

