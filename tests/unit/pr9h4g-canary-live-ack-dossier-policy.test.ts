import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dossierPath = join(process.cwd(), 'docs', 'OPS', 'PRODUCTION_CANARY_DOSSIER.md');

/** PR-9H.4G dossier gate: section exists + recorded outcome label (no fake green). */
test('PR-9H.4G: dossier section exists with bounded final_decision label', () => {
  const md = readFileSync(dossierPath, 'utf8');
  assert.match(md, /## PR-9H\.4G — Controlled Live Canary Upload \+ ACK Verification/);
  assert.match(md, /### Final decision \(`final_decision`\)/);
  assert.match(
    md,
    /\*\*`LIVE_CANARY_(ACK_GREEN|UPLOAD_FAILED_PROVIDER_CLASSIFIED|ABORTED_PREFLIGHT|ABORTED_IDENTITY_MISMATCH|ABORTED_ROW_STATE_CHANGED|HTTP_EXPORT_COMPLETE_PROVIDER_SCRIPT_PENDING)`\*\*/
  );
});

test('PR-9H.4G: dossier retains PR-9C invalid separation', () => {
  const md = readFileSync(dossierPath, 'utf8');
  const idx = md.search(/## PR-9H\.4G — Controlled Live Canary Upload \+ ACK Verification/);
  assert.ok(idx >= 0);
  const tail = md.slice(idx, idx + 12000);
  assert.match(tail, /PR-9C.*invalid.*separate|invalid.*PR-9C/i);
});
