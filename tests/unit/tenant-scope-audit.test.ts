import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function runAudit(extraPaths: string[] = []) {
  const script = path.join(process.cwd(), 'scripts', 'audit', 'require-tenant-scope.mjs');
  const args = [script];
  for (const p of extraPaths) {
    args.push('--extra-path', p);
  }
  return spawnSync(process.execPath, args, { encoding: 'utf8' });
}

test('audit:tenant-scope passes on current repo', () => {
  const r = runAudit();
  assert.equal(r.status, 0, `expected success.\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
});

test('audit:tenant-scope detects missing site scope (fixture)', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'opsmantik-tenant-scope-'));
  const dir = path.join(tmp, 'fixture');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'bad.ts');

  // Minimal fixture: adminClient.from('calls') select without any site_id scope.
  writeFileSync(
    file,
    [
      "import { adminClient } from '@/lib/supabase/admin';",
      'export async function bad() {',
      "  const { data } = await adminClient.from('calls').select('id');",
      '  return data;',
      '}',
      '',
    ].join('\n'),
    'utf8'
  );

  try {
    const r = runAudit([dir]);
    assert.equal(r.status, 1, `expected failure.\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
    assert.match(r.stderr, /bad\.ts:\d+/, 'should report file + line');
    assert.match(r.stderr, /table:\s*calls/i, 'should report table');
    assert.match(r.stderr, /missing tenant scope|missing site scope/i, 'should include reason');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

