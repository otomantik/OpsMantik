import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const RUNBOOKS = join(process.cwd(), 'docs', 'runbooks');
const RUNBOOKS_OCI_SQL_ARCHIVE = join(RUNBOOKS, '_archive', 'site-specific');

function listOciSqlRunbookPaths(): string[] {
  const paths: string[] = [];
  for (const name of readdirSync(RUNBOOKS)) {
    if (name.startsWith('oci') && name.endsWith('.sql')) {
      paths.push(join(RUNBOOKS, name));
    }
  }
  if (existsSync(RUNBOOKS_OCI_SQL_ARCHIVE)) {
    for (const name of readdirSync(RUNBOOKS_OCI_SQL_ARCHIVE)) {
      if (name.startsWith('oci') && name.endsWith('.sql')) {
        paths.push(join(RUNBOOKS_OCI_SQL_ARCHIVE, name));
      }
    }
  }
  return paths;
}
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
  const paths = listOciSqlRunbookPaths();
  assert.ok(paths.length > 0, 'expected oci*.sql runbooks (root and/or _archive/site-specific)');
  for (const p of paths) {
    const head = readFileSync(p, 'utf8').slice(0, 4000);
    const label = relative(RUNBOOKS, p).replace(/\\/g, '/');
    assert.ok(marker.test(head), `${label} must include OCI_TRUTH_PR-C or LEDGER_WARNING in the header region`);
  }
});

test('PR-C: no uncommented UPDATE offline_conversion_queue in oci*.sql runbooks', () => {
  const paths = listOciSqlRunbookPaths();
  const updateRe = /^\s*UPDATE\s+offline_conversion_queue\b/i;
  for (const p of paths) {
    const body = readFileSync(p, 'utf8');
    const label = relative(RUNBOOKS, p).replace(/\\/g, '/');
    for (const line of body.split(/\r?\n/)) {
      const t = line.trimStart();
      if (updateRe.test(t) && !t.startsWith('--')) {
        assert.fail(`${label}: uncommented UPDATE offline_conversion_queue is forbidden — use RPC / repair index`);
      }
    }
  }
});
