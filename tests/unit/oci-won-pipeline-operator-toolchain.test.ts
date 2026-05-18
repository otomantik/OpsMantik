import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

test('package.json exposes won-pipeline operator npm scripts', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  assert.equal(pkg.scripts['oci:diagnose-won-missing'], 'npx tsx scripts/oci/diagnose-won-missing.ts');
  assert.equal(pkg.scripts['oci:repair-orphan-won'], 'node scripts/db/repair-orphan-won-queue.mjs');
  assert.equal(
    pkg.scripts['oci:repair-enqueue-won-calls'],
    'npx tsx scripts/oci/repair-enqueue-won-calls.ts'
  );
});

test('WON_PIPELINE_REPAIR runbook links diagnose, SQL dry-run, enqueue, and strict gate', () => {
  const doc = readFileSync(join(ROOT, 'docs', 'runbooks', 'WON_PIPELINE_REPAIR.md'), 'utf8');
  assert.ok(doc.includes('oci:diagnose-won-missing'));
  assert.ok(doc.includes('oci:repair-orphan-won'));
  assert.ok(doc.includes('oci:repair-enqueue-won-calls'));
  assert.ok(doc.includes('smoke:oci-rollout-readiness:strict'));
  assert.ok(doc.includes('wonMissingPipeline'));
});
