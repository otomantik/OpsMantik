import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

test('INV-ProducerClick: producer and worker use shared click attribution source', () => {
  const producer = readFileSync(join(ROOT, 'lib', 'oci', 'enqueue-panel-stage-outbox.ts'), 'utf8');
  const worker = readFileSync(join(ROOT, 'lib', 'oci', 'outbox', 'process-outbox.ts'), 'utf8');
  assert.ok(
    producer.includes('resolveOciClickAttribution(') || producer.includes('getPrimarySource('),
    'producer must read click attribution via shared attribution helper'
  );
  assert.ok(worker.includes('getPrimarySource('), 'worker must read click attribution via getPrimarySource');
});

test('INV-NoSilentSuccess: producer ok requires outbox insert or persisted reconciliation', () => {
  const producer = readFileSync(join(ROOT, 'lib', 'oci', 'enqueue-panel-stage-outbox.ts'), 'utf8');
  assert.ok(
    producer.includes('return r.outboxInserted || r.reconciliationPersisted === true;'),
    'producer ok gate must fail-closed when both outboxInserted and reconciliationPersisted are false'
  );
});

test('INV-MergedNoOutbox: merged calls must skip outbox insertion plan', () => {
  const producer = readFileSync(join(ROOT, 'lib', 'oci', 'enqueue-panel-stage-outbox.ts'), 'utf8');
  assert.match(
    producer,
    /merged_into_call_id|MERGED_CALL|reconciliationOnly/i,
    'producer must contain merged-call reconciliation-only path'
  );
});

test('INV-SiteScope: OCI routes resolve site-scoped mutation versions', () => {
  const stageRoute = readFileSync(join(ROOT, 'app', 'api', 'intents', '[id]', 'stage', 'route.ts'), 'utf8');
  const statusRoute = readFileSync(join(ROOT, 'app', 'api', 'intents', '[id]', 'status', 'route.ts'), 'utf8');
  const sealRoute = readFileSync(join(ROOT, 'app', 'api', 'calls', '[id]', 'seal', 'route.ts'), 'utf8');
  for (const src of [stageRoute, statusRoute, sealRoute]) {
    assert.ok(src.includes('resolveMutationVersion'), 'mutation route must use resolveMutationVersion');
    assert.ok(src.includes('siteId') || src.includes('site_id'), 'mutation route must be site-scoped');
  }
});

test('L19 Gear Rank: process-outbox enforces higher-gear skip ordering', () => {
  const worker = readFileSync(join(ROOT, 'lib', 'oci', 'outbox', 'process-outbox.ts'), 'utf8');
  assert.match(worker, /higher|rank|preceding|blocked/i, 'worker should enforce stage precedence');
});

test('Faz6 ADR exists for outbox pre-dedupe', () => {
  const adrPath = join(ROOT, 'docs', 'architecture', 'OCI_OUTBOX_PRE_DEDUPE_ADR.md');
  assert.equal(existsSync(adrPath), true, 'outbox pre-dedupe ADR must exist');
  const adr = readFileSync(adrPath, 'utf8');
  assert.match(adr, /Implemented/i, 'ADR should reflect implemented state');
});
