/**
 * T10-2 — Root `schema*.sql` dumps must declare themselves non-authoritative
 * so security/schema reviews and release gates cannot accidentally cite them
 * over the migration chain.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const DUMP_FILES = ['schema.sql', 'schema_utf8.sql', 'supabase/schema.sql'];

/** Read the first ~3KB of a SQL dump as text, auto-detecting UTF-16 LE / BE BOMs. */
function readDumpHead(path: string, bytes = 3000): string {
  const buf = readFileSync(path);
  const head = buf.subarray(0, Math.min(bytes, buf.length));
  if (head.length >= 2 && head[0] === 0xff && head[1] === 0xfe) return head.toString('utf16le');
  if (head.length >= 2 && head[0] === 0xfe && head[1] === 0xff) {
    return head.swap16().toString('utf16le');
  }
  // pg_dump sometimes lands as UTF-16 LE without a BOM (Windows tooling). Detect by
  // looking for `XX 00 XX 00` ASCII-low-byte pattern in the first 16 bytes.
  if (head.length >= 16) {
    let zeroEven = 0;
    for (let i = 1; i < 16; i += 2) if (head[i] === 0x00) zeroEven += 1;
    if (zeroEven >= 6) return head.toString('utf16le');
  }
  return head.toString('utf8');
}

for (const rel of DUMP_FILES) {
  test(`T10-2: ${rel} declares NON-AUTHORITATIVE banner`, () => {
    const path = join(ROOT, rel);
    if (!existsSync(path)) {
      assert.ok(true, `${rel} removed — non-authoritative banner no longer needed`);
      return;
    }
    const head = readDumpHead(path);
    assert.ok(
      /NON-AUTHORITATIVE SNAPSHOT/i.test(head),
      `${rel}: first ~3KB must include 'NON-AUTHORITATIVE SNAPSHOT' banner`
    );
    assert.ok(
      /supabase\/migrations/.test(head),
      `${rel}: banner must point to supabase/migrations as SSOT`
    );
  });
}
