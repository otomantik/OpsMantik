import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dossierPath = join(process.cwd(), 'docs', 'OPS', 'PRODUCTION_CANARY_DOSSIER.md');

const PR9H4G1_FINAL_DECISION_RE =
  /\*\*`LIVE_CANARY_(ACK_GREEN|UPLOAD_FAILED_PROVIDER_CLASSIFIED|HTTP_EXPORT_COMPLETE_PROVIDER_SCRIPT_PENDING|ABORTED_PREFLIGHT|ABORTED_IDENTITY_MISMATCH|ABORTED_ROW_STATE_CHANGED)`\*\*/;

test('PR-9H.4G.1: dossier section exists with bounded final_decision label', () => {
  const md = readFileSync(dossierPath, 'utf8');
  assert.match(md, /## PR-9H\.4G\.1 — Provider upload \+ ACK closure/);
  const idx = md.search(/## PR-9H\.4G\.1 — Provider upload \+ ACK closure/);
  assert.ok(idx >= 0);
  const next = md.indexOf('\n## ', idx + 1);
  const section = next === -1 ? md.slice(idx) : md.slice(idx, next);
  assert.match(section, /### Final decision \(`final_decision`\)/);
  assert.match(section, PR9H4G1_FINAL_DECISION_RE);
});

test('PR-9H.4G.1: dossier states PR-9C invalid separation and no broad live export', () => {
  const md = readFileSync(dossierPath, 'utf8');
  const idx = md.search(/## PR-9H\.4G\.1 — Provider upload \+ ACK closure/);
  assert.ok(idx >= 0);
  const next = md.indexOf('\n## ', idx + 1);
  const section = next === -1 ? md.slice(idx) : md.slice(idx, next);
  assert.match(section, /PR-9C.*invalid.*separate|invalid.*PR-9C/i);
  assert.match(section, /[Nn]o broad live export|no second hosted.*--live/i);
});
