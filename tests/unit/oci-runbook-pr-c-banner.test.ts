import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const RUNBOOKS = join(process.cwd(), 'docs', 'runbooks');
const PROVIDERS = join(RUNBOOKS, 'PROVIDERS_UPLOAD_RUNBOOK.md');

test('PR-C: PROVIDERS_UPLOAD_RUNBOOK must not document direct UPDATE offline_conversion_queue', () => {
  const md = readFileSync(PROVIDERS, 'utf8');
  assert.ok(
    !/\bUPDATE\s+offline_conversion_queue\b/i.test(md),
    'runbook must not contain UPDATE offline_conversion_queue (use recover-processing / RPC index)'
  );
});

test('PR-C: every docs/runbooks/oci*.sql file carries OCI_TRUTH_PR-C / LEDGER_WARNING header', () => {
  const marker = /OCI_TRUTH_PR-C|LEDGER_WARNING/i;
  const files = readdirSync(RUNBOOKS).filter((f) => f.startsWith('oci') && f.endsWith('.sql'));
  assert.ok(files.length > 0, 'expected oci*.sql runbooks');
  for (const name of files) {
    const head = readFileSync(join(RUNBOOKS, name), 'utf8').slice(0, 4000);
    assert.ok(marker.test(head), `${name} must include OCI_TRUTH_PR-C or LEDGER_WARNING in the header region`);
  }
});

test('PR-C: no uncommented UPDATE offline_conversion_queue in oci*.sql runbooks', () => {
  const files = readdirSync(RUNBOOKS).filter((f) => f.startsWith('oci') && f.endsWith('.sql'));
  const updateRe = /^\s*UPDATE\s+offline_conversion_queue\b/i;
  for (const name of files) {
    const body = readFileSync(join(RUNBOOKS, name), 'utf8');
    for (const line of body.split(/\r?\n/)) {
      const t = line.trimStart();
      if (updateRe.test(t) && !t.startsWith('--')) {
        assert.fail(`${name}: uncommented UPDATE offline_conversion_queue is forbidden — use RPC / repair index`);
      }
    }
  }
});
