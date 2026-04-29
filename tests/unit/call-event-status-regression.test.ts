import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const PROCESS_CALL_EVENT = join(ROOT, 'lib', 'ingest', 'process-call-event.ts');

test('process-call-event reads existing status before null-safe enrichment patch', () => {
  const src = readFileSync(PROCESS_CALL_EVENT, 'utf8');
  assert.ok(
    src.includes('.select(\'id, created_at, status,'),
    'status must be selected so enrichment patch cannot unintentionally reset status'
  );
});

