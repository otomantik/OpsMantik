/**
 * L15 — Producer order: durable `outbox_events` insert before best-effort QStash notify.
 * If reversed, notify could fire with nothing for the worker to claim (or misleading traces).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROUTES = [
  join(process.cwd(), 'app/api/intents/[id]/stage/route.ts'),
  join(process.cwd(), 'app/api/intents/[id]/status/route.ts'),
  join(process.cwd(), 'app/api/calls/[id]/seal/route.ts'),
];

function assertEachNotifyPrecededByEnqueue(src: string, label: string) {
  const re = /\bnotifyOutboxPending\s*\(\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const pos = m.index;
    const lastEnq = src.lastIndexOf('await enqueuePanelStageOciOutbox', pos);
    assert.ok(
      lastEnq !== -1 && lastEnq < pos,
      `${label}: notifyOutboxPending at offset ${pos} must follow await enqueuePanelStageOciOutbox`
    );
  }
}

for (const path of ROUTES) {
  test(`L15 order: ${path.split('/').slice(-3).join('/')}`, () => {
    const src = readFileSync(path, 'utf8');
    assert.ok(src.includes('notifyOutboxPending'), 'route must notify');
    assert.ok(src.includes('enqueuePanelStageOciOutbox'), 'route must enqueue');
    assertEachNotifyPrecededByEnqueue(src, path);
  });
}
