/**
 * PR1 guardrails: refactor flags/observability must not change API responses when all truth flags are off.
 */
import '../mock-env';
import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

import { createSyncHandler } from '@/app/api/sync/route';
import { buildPhaseContext } from '@/lib/refactor/phase-context';
import { getRefactorFlags } from '@/lib/refactor/flags';

const TRUTH_ENV_KEYS = [
  'TRUTH_SHADOW_WRITE_ENABLED',
  'TRUTH_TYPED_EVIDENCE_ENABLED',
  'TRUTH_ENGINE_CONSOLIDATED_ENABLED',
  'TRUTH_INFERENCE_REGISTRY_ENABLED',
  'IDENTITY_GRAPH_ENABLED',
  'EXPLAINABILITY_API_ENABLED',
  'LEGACY_ENDPOINTS_ENABLED',
  'CONSENT_PROVENANCE_SHADOW_ENABLED',
] as const;

function snapshotTruthEnv(): Record<string, string | undefined> {
  const prev: Record<string, string | undefined> = {};
  for (const k of TRUTH_ENV_KEYS) {
    prev[k] = process.env[k];
  }
  return prev;
}

function restoreTruthEnv(prev: Record<string, string | undefined>): void {
  for (const k of TRUTH_ENV_KEYS) {
    const v = prev[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

const strictConfig = {
  ingest_strict_mode: false,
  ghost_geo_strict: false,
  traffic_debloat: false,
  page_view_10s_session_reuse: false,
  ingest_allow_preview_uas: false,
  referrer_allowlist: [] as string[],
  referrer_blocklist: [] as string[],
};

test('PR1: sync POST response unchanged when truth env unset vs explicitly off; call-event v2 observability snapshot matches', async () => {
  const prev = snapshotTruthEnv();
  try {
    for (const k of TRUTH_ENV_KEYS) delete process.env[k];

    const flagsUnset = getRefactorFlags();
    const ctxV2Unset = buildPhaseContext({
      route_name: '/api/call-event/v2',
      site_id: '00000000-0000-0000-0000-000000000099',
    });

    process.env.TRUTH_SHADOW_WRITE_ENABLED = 'false';
    process.env.TRUTH_TYPED_EVIDENCE_ENABLED = 'false';
    process.env.TRUTH_ENGINE_CONSOLIDATED_ENABLED = 'false';
    process.env.TRUTH_INFERENCE_REGISTRY_ENABLED = 'false';
    process.env.IDENTITY_GRAPH_ENABLED = 'false';
    process.env.EXPLAINABILITY_API_ENABLED = 'false';
    process.env.CONSENT_PROVENANCE_SHADOW_ENABLED = 'false';
    process.env.LEGACY_ENDPOINTS_ENABLED = 'true';

    const flagsExplicit = getRefactorFlags();
    const ctxV2Explicit = buildPhaseContext({
      route_name: '/api/call-event/v2',
      site_id: '00000000-0000-0000-0000-000000000099',
    });

    assert.deepEqual(flagsUnset, flagsExplicit);
    assert.deepEqual(ctxV2Unset, ctxV2Explicit);

    let publishCalls = 0;
    const handler = createSyncHandler({
      validateSite: async () => ({ valid: true, site: { id: '00000000-0000-0000-0000-000000000001' } }),
      checkRateLimit: async () => ({ allowed: true }),
      getSiteIngestConfig: async () => strictConfig,
      publish: async () => {
        publishCalls++;
      },
      executeWorker: async () => {},
    });

    const fixedIngestId = '11111111-1111-1111-1111-111111111111';
    const prevRandomUUID = globalThis.crypto.randomUUID;

    const body = JSON.stringify({
      s: 'site_public_id',
      u: 'https://example.com/page',
      sid: 'sid-1',
      sm: '2026-03-01',
      ec: 'engagement',
      ea: 'scroll_depth',
      el: '25',
      meta: { fp: 'fp-1' },
      consent_scopes: ['analytics', 'marketing'],
    });

    globalThis.crypto.randomUUID = () => fixedIngestId;
    try {
      for (const k of TRUTH_ENV_KEYS) delete process.env[k];
      const reqA = new NextRequest('http://localhost:3000/api/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://example.com' },
        body,
      });
      const resA = await handler(reqA);

      process.env.TRUTH_SHADOW_WRITE_ENABLED = 'false';
      process.env.TRUTH_TYPED_EVIDENCE_ENABLED = 'false';
      process.env.TRUTH_ENGINE_CONSOLIDATED_ENABLED = 'false';
      process.env.TRUTH_INFERENCE_REGISTRY_ENABLED = 'false';
      process.env.IDENTITY_GRAPH_ENABLED = 'false';
      process.env.EXPLAINABILITY_API_ENABLED = 'false';
      process.env.CONSENT_PROVENANCE_SHADOW_ENABLED = 'false';
      process.env.LEGACY_ENDPOINTS_ENABLED = 'true';

      const reqB = new NextRequest('http://localhost:3000/api/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://example.com' },
        body,
      });
      const resB = await handler(reqB);

      assert.equal(resA.status, resB.status);
      assert.equal(await resA.text(), await resB.text());
      assert.equal(publishCalls, 2);
    } finally {
      globalThis.crypto.randomUUID = prevRandomUUID;
    }
  } finally {
    restoreTruthEnv(prev);
  }
});
