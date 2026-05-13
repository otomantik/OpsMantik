import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

test('PR-3B: export-auth context generates exportRunId', () => {
  const authPath = join(ROOT, 'app', 'api', 'oci', 'google-ads-export', 'export-auth.ts');
  const authSrc = readFileSync(authPath, 'utf8');

  assert.match(authSrc, /const exportRunId = `oci_run_\$\{Date\.now\(\)\}_\$\{crypto\.randomUUID/i, 'Must generate run id');
  assert.match(authSrc, /exportRunId,/i, 'Must include in return context');
});

test('PR-3B: export route includes export_run_id in response shape', () => {
  const routePath = join(ROOT, 'app', 'api', 'oci', 'google-ads-export', 'route.ts');
  const routeSrc = readFileSync(routePath, 'utf8');

  assert.match(routeSrc, /export_run_id: auth\.exportRunId/i, 'Response data must include export_run_id');
});

test('PR-3B: export route emits structured logs for lineage', () => {
  const routePath = join(ROOT, 'app', 'api', 'oci', 'google-ads-export', 'route.ts');
  const routeSrc = readFileSync(routePath, 'utf8');

  assert.match(routeSrc, /logInfo\('EXPORT_RUN_STARTED'/i, 'Must log EXPORT_RUN_STARTED');
  assert.match(routeSrc, /logInfo\('EXPORT_RUN_FETCHED'/i, 'Must log EXPORT_RUN_FETCHED');
  assert.match(routeSrc, /logInfo\('EXPORT_RUN_CLAIMED'/i, 'Must log EXPORT_RUN_CLAIMED');
  assert.match(routeSrc, /logInfo\('EXPORT_RUN_CLAIM_MISMATCH'/i, 'Must log EXPORT_RUN_CLAIM_MISMATCH');
  assert.match(routeSrc, /logInfo\('EXPORT_RUN_RESPONSE_BUILT'/i, 'Must log EXPORT_RUN_RESPONSE_BUILT');
});

test('PR-3B: ACK routes parse optional export_run_id backwards compatibly', () => {
  const ackPath = join(ROOT, 'app', 'api', 'oci', 'ack', 'route.ts');
  const ackFailedPath = join(ROOT, 'app', 'api', 'oci', 'ack-failed', 'route.ts');
  
  const ackSrc = readFileSync(ackPath, 'utf8');
  const ackFailedSrc = readFileSync(ackFailedPath, 'utf8');

  assert.match(ackSrc, /exportRunId = typeof body.export_run_id === 'string' \? body.export_run_id : typeof body.run_id === 'string' \? body.run_id : req\.headers\.get\('x-opsmantik-export-run-id'\)/i, 'Must parse export_run_id from body or headers');
  assert.match(ackSrc, /export_run_id: exportRunId/i, 'Must echo export_run_id in response');
  assert.match(ackSrc, /EXPORT_RUN_ID_MISSING/i, 'Must log missing run id without failing');

  assert.match(
    ackFailedSrc,
    /typeof body\.export_run_id === 'string'[\s\S]*?typeof body\.exportRunId === 'string'[\s\S]*?typeof body\.run_id === 'string'[\s\S]*?req\.headers\.get\('x-opsmantik-export-run-id'\)/i,
    'Must parse export_run_id / exportRunId / run_id / header in ack-failed'
  );
  assert.match(ackFailedSrc, /export_run_id: exportRunId/i, 'Must echo export_run_id in response in ack-failed');
});

test('PR-3B: Release evidence includes export_run_lineage output', () => {
  const evidencePath = join(ROOT, 'scripts', 'release', 'collect-gate-evidence.mjs');
  const evidenceSrc = readFileSync(evidencePath, 'utf8');

  assert.match(evidenceSrc, /export_run_lineage: 'EXPORT_RUN_LINEAGE_PRESENT'/i, 'Must append export_run_lineage metadata');
});

test('PR-3B: Documentation clarifies run_id is not conversion identity', () => {
  const docPath = join(ROOT, 'docs', 'architecture', 'OCI_EXPORT_RUN_INTEGRITY_CONTRACT.md');
  const docSrc = readFileSync(docPath, 'utf8');

  assert.match(docSrc, /export_run_id is strictly \*\*NOT\*\* conversion identity/i, 'Must state run id is not conversion identity');
});
