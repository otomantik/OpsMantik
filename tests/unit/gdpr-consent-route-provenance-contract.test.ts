/**
 * PR2.1: contract tests — GDPR route persists consent_provenance; process-sync-event wires shadow helper.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

test('GDPR consent route: update payload includes consent_provenance + parseOptionalConsentProvenance', () => {
  const p = join(ROOT, 'app', 'api', 'gdpr', 'consent', 'route.ts');
  const src = readFileSync(p, 'utf8');
  assert.ok(src.includes('consent_provenance: provenanceForDb'), 'sessions update must set consent_provenance');
  assert.ok(src.includes('parseOptionalConsentProvenance'), 'must parse optional provenance');
});

test('process-sync-event: wires runConsentProvenanceShadowForResolvedSession', () => {
  const p = join(ROOT, 'lib', 'ingest', 'process-sync-event.ts');
  const src = readFileSync(p, 'utf8');
  assert.ok(
    src.includes('runConsentProvenanceShadowForResolvedSession'),
    'sync worker must call shadow helper after session resolution'
  );
});
