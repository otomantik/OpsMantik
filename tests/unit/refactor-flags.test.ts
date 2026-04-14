import '../mock-env';
import test from 'node:test';
import assert from 'node:assert/strict';

import { getRefactorFlags } from '@/lib/refactor/flags';

const FLAG_KEYS = [
  'TRUTH_SHADOW_WRITE_ENABLED',
  'TRUTH_TYPED_EVIDENCE_ENABLED',
  'TRUTH_ENGINE_CONSOLIDATED_ENABLED',
  'TRUTH_INFERENCE_REGISTRY_ENABLED',
  'TRUTH_PROJECTION_READ_ENABLED',
  'IDENTITY_GRAPH_ENABLED',
  'EXPLAINABILITY_API_ENABLED',
  'LEGACY_ENDPOINTS_ENABLED',
  'CONSENT_PROVENANCE_SHADOW_ENABLED',
  'TRUTH_CANONICAL_LEDGER_SHADOW_ENABLED',
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

test('getRefactorFlags: defaults — specialized off, legacy endpoints on', () => {
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
  } finally {
    restoreTruthEnv(prev);
  }
});

test('getRefactorFlags: parses 1/true/on', () => {
  const prev = clearTruthEnv();
  try {
    process.env.TRUTH_SHADOW_WRITE_ENABLED = '1';
    process.env.LEGACY_ENDPOINTS_ENABLED = 'false';
    const f = getRefactorFlags();
    assert.equal(f.truth_shadow_write_enabled, true);
    assert.equal(f.legacy_endpoints_enabled, false);
  } finally {
    restoreTruthEnv(prev);
  }
});
