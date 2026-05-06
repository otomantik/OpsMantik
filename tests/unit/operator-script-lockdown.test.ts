import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

test('enqueue-orphan script is dry-run first and guarded for write mode', () => {
  const src = readFileSync(join(ROOT, 'scripts/db/enqueue-orphan-calls-for-site.ts'), 'utf8');
  assert.ok(src.includes("const writeMode = args.includes('--write')"));
  assert.ok(src.includes('const dryRun = !writeMode'));
  assert.ok(src.includes('CHANGE_TICKET'));
  assert.ok(src.includes('OPERATOR_ID'));
});

