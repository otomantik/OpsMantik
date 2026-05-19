import { RETIRED_AUDIT_TABLE, RETIRED_FROM_CLAUSE, RETIRED_CLEANUP_RPC } from '../helpers/retired-oci-vocabulary';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dossierPath = join(process.cwd(), 'docs', 'OPS', 'PRODUCTION_CANARY_DOSSIER.md');

const PR9H4G3_FINAL_DECISION_RE =
  /\*\*`LIVE_CANARY_(ACK_GREEN|UPLOAD_COMPLETE_ACK_STILL_PENDING|UPLOAD_COMPLETE_ACK_PREFIX_MISMATCH|ABORTED_PEEK_ALLOWLIST_MISMATCH|PROVIDER_LANE_BLOCKED_BY_EXISTING_PROCESSING_CLAIM)`\*\*/;

test('PR-9H.4G.3: dossier section exists with evidence strings and bounded final_decision', () => {
  const md = readFileSync(dossierPath, 'utf8');
  assert.match(md, /PR-9H\.4G\.3/);
  assert.match(md, /## PR-9H\.4G\.3 — Google Ads Script upload \+ ACK closure/);
  const idx = md.search(/## PR-9H\.4G\.3 — Google Ads Script upload \+ ACK closure/);
  assert.ok(idx >= 0);
  const next = md.indexOf('\n## ', idx + 1);
  const section = next === -1 ? md.slice(idx) : md.slice(idx, next);
  assert.match(section, /### Final decision \(`final_decision`\)/);
  assert.match(section, PR9H4G3_FINAL_DECISION_RE);
  assert.match(section, /\*\*`LIVE_CANARY_ACK_GREEN`\*\*/);
  assert.match(section, /seal_0b298a99-673a-4cd1-a2c1-94a3b192e47c/);
  assert.match(section, /0b298a99-673a-4cd1-a2c1-94a3b192e47c/);
  assert.match(section, /oci_run_1778283754599_53b8ee1a/);
  assert.match(section, /PEEK_GREEN_SINGLE_ALLOWLIST_ROW_FOUND/);
  assert.match(section, /ACK_UNKNOWN_PREFIX/);
  assert.match(section, /receipt_persist_warning/);
});

test('PR-9H.4G.3: dossier states safety invariants (no broad export, no second upload, PR-9C, SSOT)', () => {
  const md = readFileSync(dossierPath, 'utf8');
  const idx = md.search(/## PR-9H\.4G\.3 — Google Ads Script upload \+ ACK closure/);
  assert.ok(idx >= 0);
  const next = md.indexOf('\n## ', idx + 1);
  const section = next === -1 ? md.slice(idx) : md.slice(idx, next);
  assert.match(section, /[Nn]o broad live export|No broad live export/i);
  assert.match(section, /[Dd]o not.*re-run.*sync|no second.*upload|Do not.*upload.*again/i);
  assert.match(section, /PR-9C.*invalid.*separate|invalid.*PR-9C/i);
  assert.match(section, /offline_conversion_queue.*upload authority|single upload authority/i);
  assert.match(section, /offline_conversion_queue.*upload authority|single upload authority/i);
});
