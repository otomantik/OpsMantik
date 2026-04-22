/**
 * Phase 5 hardening pins — lock in invariants that ops depends on.
 *
 * Covers five surfaces that were explicitly called out as fragile in the
 * global-launch review:
 *   1) Seal kill-switch  — OCI_SEAL_PAUSED as first-line env gate.
 *   2) Outbox claim RPC  — FOR UPDATE SKIP LOCKED + attempt_count increment.
 *   3) Outbox retry cap  — OUTBOX_MAX_ATTEMPTS wired into the processor.
 *   4) CHECK constraints — marketing_signals.occurred_at_source + sites locale.
 *   5) Hash helper SSOT  — only marketing-signal-hash.ts owns the computation.
 *
 * All tests are static — they inspect migration files and source to pin
 * behaviour no DB round-trip required.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

function latestMigrationContaining(pattern: RegExp): { file: string; body: string } | null {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (let i = files.length - 1; i >= 0; i--) {
    const full = join(MIGRATIONS, files[i]);
    const body = readFileSync(full, 'utf8');
    if (pattern.test(body)) return { file: files[i], body };
  }
  return null;
}

// ---------------------------------------------------------------------------
// 1) Seal kill-switch
// ---------------------------------------------------------------------------

test('seal route honors OCI_SEAL_PAUSED as its first-line kill switch', () => {
  const src = readFileSync(join(ROOT, 'app/api/calls/[id]/seal/route.ts'), 'utf8');

  // Guard must accept both 'true' and '1' (historical reasons).
  assert.match(
    src,
    /OCI_SEAL_PAUSED\s*===\s*'true'\s*\|\|\s*process\.env\.OCI_SEAL_PAUSED\s*===\s*'1'/,
    'kill-switch must accept both true and 1 to stay ops-friendly'
  );

  // The guard must return 503 with a stable code string so ops alerts can
  // match on it.
  assert.match(src, /code:\s*'SEAL_PAUSED'/, 'error code SEAL_PAUSED missing');
  assert.match(src, /status:\s*503/, 'paused response must be 503 for load balancer signalling');

  // Guard must run BEFORE the body is parsed or any DB lookup is performed.
  const guardIdx = src.indexOf('OCI_SEAL_PAUSED');
  const bodyIdx = src.indexOf('await req.json()');
  const adminIdx = src.indexOf("adminClient\n");
  assert.ok(guardIdx > 0, 'kill-switch guard not found');
  assert.ok(guardIdx < bodyIdx, 'kill-switch must run before body parse');
  if (adminIdx > 0) {
    assert.ok(guardIdx < adminIdx, 'kill-switch must run before any adminClient call');
  }
});

// ---------------------------------------------------------------------------
// 2) Outbox claim RPC
// ---------------------------------------------------------------------------

test('claim_outbox_events uses FOR UPDATE SKIP LOCKED and increments attempt_count', () => {
  const hit = latestMigrationContaining(/claim_outbox_events/);
  assert.ok(hit, 'no migration defines claim_outbox_events');
  assert.match(hit!.body, /FOR UPDATE\s+(?:OF\s+\w+\s+)?SKIP LOCKED/i, 'claim RPC must use SKIP LOCKED');
  assert.match(
    hit!.body,
    /attempt_count\s*=\s*\w+\.attempt_count\s*\+\s*1/i,
    'claim RPC must increment attempt_count so retries are observable'
  );
  assert.match(
    hit!.body,
    /status\s*=\s*'PROCESSING'/i,
    'claim RPC must flip PENDING → PROCESSING atomically'
  );
  assert.match(
    hit!.body,
    /auth\.role\(\)\s+IS\s+DISTINCT\s+FROM\s+'service_role'/i,
    'claim RPC must reject non-service_role callers'
  );
});

// ---------------------------------------------------------------------------
// 3) Outbox retry cap
// ---------------------------------------------------------------------------

test('runProcessOutbox caps retries via OUTBOX_MAX_ATTEMPTS', () => {
  const src = readFileSync(
    join(ROOT, 'lib/oci/outbox/process-outbox.ts'),
    'utf8'
  );
  assert.match(src, /export const OUTBOX_MAX_ATTEMPTS\s*=\s*\d+/, 'retry cap constant missing');
  // Retry path must use claim-owned attempt_count and flip to FAILED when the cap is hit.
  assert.match(src, /attemptCount\s*>=\s*OUTBOX_MAX_ATTEMPTS/, 'retry cap branch missing');
  assert.match(
    src,
    /attemptCount\s*>=\s*OUTBOX_MAX_ATTEMPTS\s*\?\s*'FAILED'\s*:\s*'PENDING'/,
    'retry cap must flip FAILED vs PENDING based on the counter'
  );
  assert.doesNotMatch(
    src,
    /attemptCount\s*\+\s*1/,
    'retry path must not double-increment attempt_count after claim RPC'
  );

  // 5 is the documented cap today. Future changes must be deliberate.
  const match = src.match(/export const OUTBOX_MAX_ATTEMPTS\s*=\s*(\d+)/);
  assert.ok(match, 'could not parse OUTBOX_MAX_ATTEMPTS');
  const cap = Number(match![1]);
  assert.ok(cap >= 3 && cap <= 10, `OUTBOX_MAX_ATTEMPTS=${cap} outside the sane range [3,10]`);
});

// ---------------------------------------------------------------------------
// 4) CHECK constraints
// ---------------------------------------------------------------------------

test('marketing_signals.occurred_at_source CHECK allows the canonical set', () => {
  const hit = latestMigrationContaining(/marketing_signals_occurred_at_source_check/);
  assert.ok(hit, 'no migration touches marketing_signals_occurred_at_source_check');
  // The allowed set must include sale (added in 20260419130000) and must not
  // silently drop intent / qualified / proposal.
  for (const value of ['intent', 'qualified', 'proposal', 'sale', 'legacy_migrated']) {
    assert.ok(
      new RegExp(`'${value}'`).test(hit!.body),
      `CHECK allowed set missing '${value}'`
    );
  }
});

test('sites locale CHECK constraints are pinned to ISO-4217 and IANA shapes', () => {
  const path = join(MIGRATIONS, '20260419200000_sites_locale_strict_check.sql');
  assert.ok(existsSync(path), 'locale CHECK migration is missing');
  const body = readFileSync(path, 'utf8');
  assert.match(body, /sites_currency_iso4217_chk/, 'currency CHECK name drifted');
  assert.match(body, /sites_timezone_iana_chk/, 'timezone CHECK name drifted');
  assert.match(
    body,
    /CHECK\s*\(currency\s*~\s*'\^\[A-Z\]\{3\}\$'/,
    'currency CHECK must enforce 3-letter ISO-4217 shape'
  );
  assert.match(
    body,
    /timezone\s*=\s*'UTC'/,
    'timezone CHECK must accept the bare UTC literal'
  );
});

test('sites.default_country_iso CHECK is pinned to ISO-3166-1 alpha-2 shape', () => {
  const path = join(MIGRATIONS, '20260419210000_sites_country_iso_strict_check.sql');
  assert.ok(existsSync(path), 'country_iso CHECK migration is missing');
  const body = readFileSync(path, 'utf8');
  assert.match(body, /sites_default_country_iso_chk/, 'country_iso CHECK name drifted');
  assert.match(
    body,
    /CHECK\s*\(\s*default_country_iso IS NULL\s*OR\s*default_country_iso\s*~\s*'\^\[A-Z\]\{2\}\$'/,
    'country_iso CHECK must enforce ISO-3166-1 alpha-2 shape (2 uppercase letters), NULL allowed for legacy rows'
  );
});

// ---------------------------------------------------------------------------
// 5) Hash helper SSOT
// ---------------------------------------------------------------------------

test('only marketing-signal-hash.ts implements computeMarketingSignalCurrentHash', () => {
  const extensions = new Set(['.ts', '.tsx']);
  const skipDirs = new Set([
    'node_modules',
    '.next',
    '.git',
    'coverage',
    'dist',
    'build',
    '.vercel',
    'out',
    'tests',
  ]);
  const hits: string[] = [];

  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (skipDirs.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const dot = entry.name.lastIndexOf('.');
      const ext = dot >= 0 ? entry.name.slice(dot) : '';
      if (!extensions.has(ext)) continue;
      const body = readFileSync(full, 'utf8');
      if (/export function computeMarketingSignalCurrentHash\b/.test(body)) {
        hits.push(full);
      }
    }
  }
  walk(ROOT);

  assert.equal(
    hits.length,
    1,
    `expected exactly one runtime implementation of computeMarketingSignalCurrentHash, got:\n${hits.join('\n')}`
  );
  assert.ok(
    hits[0].replace(/\\/g, '/').endsWith('lib/oci/marketing-signal-hash.ts'),
    `unexpected implementation location: ${hits[0]}`
  );
});

test('ack and ack-failed routes use shared oci script auth helper', () => {
  const ack = readFileSync(join(ROOT, 'app/api/oci/ack/route.ts'), 'utf8');
  const ackFailed = readFileSync(join(ROOT, 'app/api/oci/ack-failed/route.ts'), 'utf8');
  for (const src of [ack, ackFailed]) {
    assert.ok(
      src.includes("from '@/lib/oci/script-auth'"),
      'route must import shared script-auth helper'
    );
    assert.ok(/resolveOciScriptAuth\(/.test(src), 'route must call resolveOciScriptAuth');
    assert.ok(
      !src.includes("from '@/lib/services/rate-limit-service'"),
      'route must not own per-route auth fail rate-limit logic after extraction'
    );
    assert.ok(
      !src.includes("from '@/lib/security/timing-safe-compare'"),
      'route must not own per-route api-key compare logic after extraction'
    );
    assert.ok(
      !src.includes("from '@/lib/oci/session-auth'"),
      'route must not own per-route session token parsing after extraction'
    );
  }
});
