import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();

function exists(rel: string): boolean {
  return fs.existsSync(path.join(root, rel));
}

test('tier2 gate: formal invariant spec exists', () => {
  assert.equal(exists('specs/invariants/tla/InvariantCrucible.tla'), true);
  assert.equal(exists('specs/invariants/tla/InvariantCrucible.cfg'), true);
});

test('tier2 gate: anti-entropy eslint plugin exists', () => {
  assert.equal(exists('tools/eslint-plugin-opsmantik-void/index.js'), true);
});

test('tier2 gate: kernel xdp guard snippet exists', () => {
  assert.equal(exists('infra/ebpf/xdp-oci-guard/src/main.rs'), true);
});

test('tier2 gate: chaos drills exist', () => {
  assert.equal(exists('tests/chaos/duplicate-storm.test.ts'), true);
  assert.equal(exists('tests/chaos/outbox-zombie.test.ts'), true);
  assert.equal(exists('tests/chaos/ack-race.test.ts'), true);
});
