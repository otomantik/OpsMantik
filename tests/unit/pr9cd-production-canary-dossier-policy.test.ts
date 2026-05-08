import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dossierPath = join(process.cwd(), 'docs', 'OPS', 'PRODUCTION_CANARY_DOSSIER.md');

test('PR-9D dossier exists and includes reconciliation equations A-E', () => {
  assert.ok(existsSync(dossierPath), 'production canary dossier must exist');
  const src = readFileSync(dossierPath, 'utf8');
  assert.match(src, /Eq A:/);
  assert.match(src, /Eq B:/);
  assert.match(src, /Eq C:/);
  assert.match(src, /Eq D:/);
  assert.match(src, /Eq E:/);
});

test('PR-9D policy: success cannot be claimed without post-canary production evidence', () => {
  const src = readFileSync(dossierPath, 'utf8');
  assert.match(src, /Post-Canary Production Evidence/);
  assert.match(src, /\|\s*target_db_contract_status\s*\|\s*`TARGET_DB_GREEN`\s*\|/);
});

test('PR-9D policy: unresolved PROCESSING row blocks success declaration', () => {
  const src = readFileSync(dossierPath, 'utf8');
  assert.match(src, /\|\s*`6c1537a7-98ca-47eb-8bd9-67c35965cf9d`\s*\|[\s\S]*?\|\s*`PROCESSING`\s*\|/i);
  assert.doesNotMatch(src, /PRODUCTION_CANARY_SUCCESS/);
});

test('PR-9D safety policy includes forbidden manual COMPLETED and queue deletion', () => {
  const src = readFileSync(dossierPath, 'utf8');
  assert.match(src, /manual COMPLETED transitions are forbidden/i);
  assert.match(src, /queue row deletion is forbidden/i);
});

test('PR-9D dossier captures canary scope and known caveats', () => {
  const src = readFileSync(dossierPath, 'utf8');
  assert.match(src, /max_batch_size: `1`/i);
  assert.match(src, /stuck_processing risk exists/i);
  assert.match(src, /required_reapproval_present: `NO_EVIDENCE_FOUND`/i);
  assert.match(src, /CANARY_PROCESS_VIOLATION_REVIEW_REQUIRED/);
});
