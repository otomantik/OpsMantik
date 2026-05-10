import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dossierPath = join(process.cwd(), 'docs', 'OPS', 'PRODUCTION_CANARY_DOSSIER.md');

/** PR-9H.4G.2 outcome labels recorded in dossier `final_decision`. */
const PR9H4G2_BLOCKED_RE =
  /\*\*`LIVE_CANARY_PROVIDER_LANE_BLOCKED_BY_EXISTING_PROCESSING_CLAIM`\*\*/;

test('PR-9H.4G.2: dossier documents CANARY_EXPORT_BLOCKED operator attempt + recovery path', () => {
  const md = readFileSync(dossierPath, 'utf8');
  assert.match(md, /## PR-9H\.4G\.2 — Google Ads Script blocked/);
  const idx = md.search(/## PR-9H\.4G\.2 — Google Ads Script blocked/);
  assert.ok(idx >= 0);
  const next = md.indexOf('\n## ', idx + 1);
  const section = next === -1 ? md.slice(idx) : md.slice(idx, next);
  assert.match(section, /### Final decision \(`final_decision`\)/);
  assert.match(section, PR9H4G2_BLOCKED_RE);
  assert.match(section, /CANARY_EXPORT_BLOCKED|HTTP 409/i);
  assert.match(section, /pr9h4c-recover-claimed-not-uploaded|PR9H4C_RECOVERED_TO_RETRY/i);
  assert.match(section, /PR-9C.*invalid.*separate|invalid.*PR-9C/i);
  assert.match(section, /no ACK_FAILED|ACK_FAILED.*not/i);
});
