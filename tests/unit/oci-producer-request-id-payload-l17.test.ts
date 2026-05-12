/**
 * L17 — Producer must pin `request_id` onto `outbox_events.payload` when supplied
 * so Vercel/edge logs join Supabase rows for the exact PENDING insertion.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PRODUCER = join(process.cwd(), 'lib/oci/enqueue-panel-stage-outbox.ts');

test('L17: producer threads requestId into payload.request_id', () => {
  const src = readFileSync(PRODUCER, 'utf8');
  assert.ok(
    src.includes('requestId: options?.requestId') ||
      src.includes("options?.requestId?.trim()") ||
      src.includes('options?.requestId'),
    'producer must read requestId from PanelStageOciEnqueueOptions'
  );
  assert.ok(
    src.includes('request_id: requestId'),
    'payload must include request_id when requestId truthy'
  );
});

const ROUTES = [
  'app/api/intents/[id]/stage/route.ts',
  'app/api/intents/[id]/status/route.ts',
  'app/api/calls/[id]/seal/route.ts',
];

for (const rel of ROUTES) {
  test(`L17: ${rel} passes { requestId } to enqueuePanelStageOciOutbox`, () => {
    const src = readFileSync(join(process.cwd(), rel), 'utf8');
    assert.ok(
      /enqueuePanelStageOciOutbox\([^)]*\{\s*requestId\s*\}\s*\)/.test(src),
      `${rel}: must call enqueuePanelStageOciOutbox(..., { requestId })`
    );
  });
}
