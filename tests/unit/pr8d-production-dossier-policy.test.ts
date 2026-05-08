import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

test('PR-8D production promotion dossier exists', () => {
  assert.equal(existsSync(join(ROOT, 'docs', 'OPS', 'PRODUCTION_PROMOTION_DOSSIER.md')), true);
});

test('PR-8D dossier pins GO policy prerequisites', () => {
  const src = readFileSync(join(ROOT, 'docs', 'OPS', 'PRODUCTION_PROMOTION_DOSSIER.md'), 'utf8');
  for (const token of [
    'target_db_checked = true',
    'target_db_contract_status = TARGET_DB_GREEN',
    'blocking_failures = []',
    'unsafe_grant_count = 0',
    'static green cannot authorize production',
    'rollback/freeze drill',
    'Waiver List',
    'GO / NO-GO',
    'tmp/release-gates-production.json',
    'SSL/pooler DSN caveat',
    'sslmode=no-verify',
  ]) {
    assert.ok(src.includes(token), `dossier must include ${token}`);
  }
});
