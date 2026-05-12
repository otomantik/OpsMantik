/**
 * T10-11 — `processSingleOciExport` must reject rows whose `claimed_by` is
 * not the FASTPATH owner (cron / sweep claims are off-limits to fast path).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PATH = join(process.cwd(), 'lib/oci/process-single-oci-export.ts');

test('T10-11: claim_owner equality check is present', () => {
  const src = readFileSync(PATH, 'utf8');
  assert.ok(
    src.includes("claimedBy !== 'FASTPATH_OCI_EXPORT'"),
    'must compare claimed_by against the FASTPATH owner literal'
  );
  assert.ok(
    src.includes('fastpath_claim_owner_mismatch_total'),
    'must increment mismatch metric on rejection'
  );
  assert.ok(
    src.includes("'FASTPATH_CLAIM_OWNER_MISMATCH'"),
    'must return explicit error code'
  );
});

test('T10-11: claim_owner check runs after claim-evidence check', () => {
  const src = readFileSync(PATH, 'utf8');
  const evidenceIdx = src.indexOf('UNCLAIMED_FASTPATH');
  const ownerIdx = src.indexOf('FASTPATH_CLAIM_OWNER_MISMATCH');
  assert.ok(evidenceIdx !== -1 && ownerIdx !== -1, 'both checks must exist');
  assert.ok(evidenceIdx < ownerIdx, 'owner equality must follow evidence check');
});
