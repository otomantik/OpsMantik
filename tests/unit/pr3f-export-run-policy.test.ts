import test from 'node:test';
import assert from 'node:assert';
import { evaluateExportRunPromotionPolicy } from '@/lib/oci/export-run-policy';

test('PR-3F Policy: static mode passes with STATIC_EXPORT_CONTRACT_GREEN', () => {
  const result = evaluateExportRunPromotionPolicy({
    mode: 'static',
    strict: false,
    export_run_integrity: 'STATIC_EXPORT_CONTRACT_GREEN'
  });
  assert.strictEqual(result.pass, true);
  assert.strictEqual(result.warnings.length, 0);
});

test('PR-3F Policy: static mode passes but warns if integrity is UNVERIFIED', () => {
  const result = evaluateExportRunPromotionPolicy({
    mode: 'static',
    strict: false,
    export_run_integrity: 'EXPORT_RUN_INTEGRITY_UNVERIFIED'
  });
  assert.strictEqual(result.pass, true);
  assert.ok(result.warnings.length > 0);
});

test('PR-3F Policy: strict mode fails on EXPORT_RUN_INTEGRITY_UNVERIFIED without waiver', () => {
  const result = evaluateExportRunPromotionPolicy({
    mode: 'production',
    strict: true,
    export_run_integrity: 'EXPORT_RUN_INTEGRITY_UNVERIFIED'
  });
  assert.strictEqual(result.pass, false);
  assert.strictEqual(result.waiver_required, true);
  assert.strictEqual(result.status, 'POLICY_FAILED_MISSING_WAIVER');
});

test('PR-3F Policy: strict mode fails on EXPORT_RUN_INTEGRITY_PARTIAL without waiver', () => {
  const result = evaluateExportRunPromotionPolicy({
    mode: 'staging',
    strict: true,
    export_run_integrity: 'EXPORT_RUN_INTEGRITY_PARTIAL'
  });
  assert.strictEqual(result.pass, false);
  assert.strictEqual(result.waiver_required, true);
});

test('PR-3F Policy: strict mode fails on EXPORT_RUN_INTEGRITY_RED (hard blocker)', () => {
  const result = evaluateExportRunPromotionPolicy({
    mode: 'production',
    strict: true,
    export_run_integrity: 'EXPORT_RUN_INTEGRITY_RED'
  });
  assert.strictEqual(result.pass, false);
  assert.strictEqual(result.waiver_required, false); // cannot be waived
});

test('PR-3F Policy: strict mode passes on EXPORT_RUN_INTEGRITY_GREEN', () => {
  const result = evaluateExportRunPromotionPolicy({
    mode: 'production',
    strict: true,
    export_run_integrity: 'EXPORT_RUN_INTEGRITY_GREEN'
  });
  assert.strictEqual(result.pass, true);
  assert.strictEqual(result.waiver_required, false);
});

test('PR-3F Policy: valid waiver allows PARTIAL', () => {
  const futureExpiry = new Date(Date.now() + 86400 * 1000).toISOString();
  const result = evaluateExportRunPromotionPolicy({
    mode: 'production',
    strict: true,
    export_run_integrity: 'EXPORT_RUN_INTEGRITY_PARTIAL',
    waiver: {
      owner: 'Alice',
      reason: 'Known bug in script summary',
      expiry: futureExpiry,
      blast_radius: 'None'
    }
  });
  assert.strictEqual(result.pass, true);
  assert.strictEqual(result.waiver_accepted, true);
  assert.strictEqual(result.status, 'POLICY_PASSED_WITH_WAIVER');
});

test('PR-3F Policy: incomplete waiver fails', () => {
  const futureExpiry = new Date(Date.now() + 86400 * 1000).toISOString();
  const result = evaluateExportRunPromotionPolicy({
    mode: 'production',
    strict: true,
    export_run_integrity: 'EXPORT_RUN_INTEGRITY_PARTIAL',
    waiver: {
      owner: 'Alice',
      // missing reason, blast_radius
      expiry: futureExpiry
    }
  });
  assert.strictEqual(result.pass, false);
  assert.strictEqual(result.status, 'POLICY_FAILED_INVALID_WAIVER');
});

test('PR-3F Policy: expired waiver fails', () => {
  const pastExpiry = new Date(Date.now() - 86400 * 1000).toISOString();
  const result = evaluateExportRunPromotionPolicy({
    mode: 'production',
    strict: true,
    export_run_integrity: 'EXPORT_RUN_INTEGRITY_UNVERIFIED',
    waiver: {
      owner: 'Alice',
      reason: 'Need time to fix',
      expiry: pastExpiry,
      blast_radius: 'None'
    }
  });
  assert.strictEqual(result.pass, false);
  assert.strictEqual(result.status, 'POLICY_FAILED_EXPIRED_WAIVER');
});

test('PR-3F Policy: RED is not silently waived', () => {
  const futureExpiry = new Date(Date.now() + 86400 * 1000).toISOString();
  const result = evaluateExportRunPromotionPolicy({
    mode: 'production',
    strict: true,
    export_run_integrity: 'EXPORT_RUN_INTEGRITY_RED',
    waiver: {
      owner: 'Alice',
      reason: 'Trying to waive RED',
      expiry: futureExpiry,
      blast_radius: 'High'
    }
  });
  // Should still fail
  assert.strictEqual(result.pass, false);
  assert.strictEqual(result.waiver_required, false); // Cannot even try to waive
});
