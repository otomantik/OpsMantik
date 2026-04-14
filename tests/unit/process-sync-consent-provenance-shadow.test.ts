/**
 * PR2.1: sync worker wires consent provenance shadow helper; unit coverage with injectable fetch.
 */
import '../mock-env';
import test from 'node:test';
import assert from 'node:assert/strict';

import { runConsentProvenanceShadowForResolvedSession } from '@/lib/compliance/consent-provenance-shadow';
import { getRefactorMetricsMemory, resetRefactorMetricsMemoryForTests } from '@/lib/refactor/metrics';

const SITE = '00000000-0000-0000-0000-000000000001';
const SID = '00000000-0000-0000-0000-000000000002';
const MONTH = '2026-04-01';

test('runConsentProvenanceShadowForResolvedSession: flag off — no fetch, no shadow metrics', async () => {
  const prev = process.env.CONSENT_PROVENANCE_SHADOW_ENABLED;
  try {
    delete process.env.CONSENT_PROVENANCE_SHADOW_ENABLED;
    resetRefactorMetricsMemoryForTests();
    let fetchCalls = 0;
    await runConsentProvenanceShadowForResolvedSession(
      SITE,
      { id: SID, created_month: MONTH },
      true,
      async () => {
        fetchCalls++;
        return null;
      }
    );
    assert.equal(fetchCalls, 0);
    assert.equal(getRefactorMetricsMemory().consent_provenance_shadow_check_total, 0);
  } finally {
    if (prev === undefined) delete process.env.CONSENT_PROVENANCE_SHADOW_ENABLED;
    else process.env.CONSENT_PROVENANCE_SHADOW_ENABLED = prev;
  }
});

test('runConsentProvenanceShadowForResolvedSession: flag on + fetch null → missing_session', async () => {
  const prev = process.env.CONSENT_PROVENANCE_SHADOW_ENABLED;
  try {
    process.env.CONSENT_PROVENANCE_SHADOW_ENABLED = '1';
    resetRefactorMetricsMemoryForTests();
    await runConsentProvenanceShadowForResolvedSession(
      SITE,
      { id: SID, created_month: MONTH },
      true,
      async () => null
    );
    const m = getRefactorMetricsMemory();
    assert.equal(m.consent_provenance_shadow_check_total, 1);
    assert.equal(m.consent_provenance_shadow_missing_session_total, 1);
  } finally {
    if (prev === undefined) delete process.env.CONSENT_PROVENANCE_SHADOW_ENABLED;
    else process.env.CONSENT_PROVENANCE_SHADOW_ENABLED = prev;
  }
});

test('runConsentProvenanceShadowForResolvedSession: flag on + cmp + analytics → ok', async () => {
  const prev = process.env.CONSENT_PROVENANCE_SHADOW_ENABLED;
  try {
    process.env.CONSENT_PROVENANCE_SHADOW_ENABLED = '1';
    resetRefactorMetricsMemoryForTests();
    await runConsentProvenanceShadowForResolvedSession(
      SITE,
      { id: SID, created_month: MONTH },
      true,
      async () => ({
        consent_scopes: ['analytics'],
        consent_at: '2026-01-01T00:00:00.000Z',
        consent_provenance: { source: 'cmp' },
      })
    );
    const m = getRefactorMetricsMemory();
    assert.equal(m.consent_provenance_shadow_check_total, 1);
    assert.equal(m.consent_provenance_shadow_ok_total, 1);
  } finally {
    if (prev === undefined) delete process.env.CONSENT_PROVENANCE_SHADOW_ENABLED;
    else process.env.CONSENT_PROVENANCE_SHADOW_ENABLED = prev;
  }
});
