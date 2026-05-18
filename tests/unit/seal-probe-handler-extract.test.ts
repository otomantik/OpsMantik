import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

test('seal route delegates probe path to handleSealProbePost', () => {
  const route = readFileSync(join(ROOT, 'app', 'api', 'calls', '[id]', 'seal', 'route.ts'), 'utf8');
  assert.ok(route.includes("from '@/lib/api/calls/seal-probe-handler'"));
  assert.ok(route.includes('handleSealProbePost('));
  assert.ok(!route.includes('PROBE_SEAL_SIGNATURE_REJECTED'));
});

test('seal probe handler keeps probe_v2 outbox notify contract', () => {
  const probe = readFileSync(join(ROOT, 'lib', 'api', 'calls', 'seal-probe-handler.ts'), 'utf8');
  assert.ok(probe.includes("source: 'probe_v2'"));
  assert.ok(probe.includes("source: 'seal_probe_v2'"));
  assert.ok(probe.includes('verifyProbeSignature'));
  assert.ok(probe.includes('apply_call_action_v2'));
});
