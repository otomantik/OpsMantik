import '../mock-env';
import test from 'node:test';
import assert from 'node:assert/strict';

import { getRefactorFlags } from '@/lib/refactor/flags';

const FLAG_KEYS = [
  'TRUTH_SHADOW_WRITE_ENABLED',
  'TRUTH_TYPED_EVIDENCE_ENABLED',
  'TRUTH_ENGINE_CONSOLIDATED_ENABLED',
  'TRUTH_INFERENCE_REGISTRY_ENABLED',
  'IDENTITY_GRAPH_ENABLED',
  'EXPLAINABILITY_API_ENABLED',
  'LEGACY_ENDPOINTS_ENABLED',
  'CONSENT_PROVENANCE_SHADOW_ENABLED',
  'TRUTH_CANONICAL_LEDGER_SHADOW_ENABLED',
  'STRICT_MUTATION_VERSION_ENFORCE',
  'TRUTH_PARITY_MODE',
  'LEASE_LOCK_MODE',
  'SITE_TIMEZONE_STRICT_MODE',
] as const;

function clearTruthEnv(): Record<string, string | undefined> {
  const prev: Record<string, string | undefined> = {};
  for (const k of FLAG_KEYS) {
    prev[k] = process.env[k];
    delete process.env[k];
  }
  return prev;
}

function restoreTruthEnv(prev: Record<string, string | undefined>): void {
  for (const k of FLAG_KEYS) {
    const v = prev[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

test('getRefactorFlags: defaults — integrity strict modes on, legacy endpoints on', () => {
  const prev = clearTruthEnv();
  try {
    const f = getRefactorFlags();
    assert.equal(f.truth_shadow_write_enabled, false);
    assert.equal(f.truth_typed_evidence_enabled, false);
    assert.equal(f.explainability_api_enabled, false);
    assert.equal(f.consent_provenance_shadow_enabled, false);
    assert.equal(f.truth_canonical_ledger_shadow_enabled, false);
    assert.equal(f.truth_engine_consolidated_enabled, false);
    assert.equal(f.legacy_endpoints_enabled, true);
    assert.equal(f.strict_mutation_version_enforce, true);
    assert.equal(f.truth_parity_mode, 'detect');
    assert.equal(f.lease_lock_mode, 'lease');
    assert.equal(f.site_timezone_strict_mode, true);
  } finally {
    restoreTruthEnv(prev);
  }
});

test('getRefactorFlags: parses 1/true/on', () => {
  const prev = clearTruthEnv();
  try {
    process.env.TRUTH_SHADOW_WRITE_ENABLED = '1';
    process.env.LEGACY_ENDPOINTS_ENABLED = 'false';
    process.env.STRICT_MUTATION_VERSION_ENFORCE = 'true';
    process.env.TRUTH_PARITY_MODE = 'detect';
    process.env.LEASE_LOCK_MODE = 'lease';
    process.env.SITE_TIMEZONE_STRICT_MODE = '1';
    const f = getRefactorFlags();
    assert.equal(f.truth_shadow_write_enabled, true);
    assert.equal(f.legacy_endpoints_enabled, false);
    assert.equal(f.strict_mutation_version_enforce, true);
    assert.equal(f.truth_parity_mode, 'detect');
    assert.equal(f.lease_lock_mode, 'lease');
    assert.equal(f.site_timezone_strict_mode, true);
  } finally {
    restoreTruthEnv(prev);
  }
});
