import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

/** Legacy migration retained in chain; superseded by 20261226000000 REVOKE/GRANT fix. */
const ALLOW_GRANT_ALL_TO_ANON = new Set(['20261223020200_oci_queue_transitions_ledger_and_claim_rpcs.sql']);

test('migrations: no new GRANT ALL … TO anon/authenticated (except legacy allowlist)', () => {
  const dir = join(process.cwd(), 'supabase', 'migrations');
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.sql'))) {
    const body = readFileSync(join(dir, name), 'utf8');
    for (const raw of body.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('--')) continue;
      if (!/GRANT\s+ALL\s+ON/i.test(line)) continue;
      if (!/\b(anon|authenticated)\b/i.test(line)) continue;
      assert.ok(
        ALLOW_GRANT_ALL_TO_ANON.has(name),
        `Unexpected broad GRANT in ${name}: ${line.slice(0, 160)}`
      );
    }
  }
});
