/**
 * Phase 5 — timezone edge + phone hash SSOT pins.
 *
 * Two architecture invariants for the global launch:
 *   1) Auto-junk runs on UTC `expires_at`. Any Europe/Istanbul hardcode or
 *      local-time comparison would silently junk leads early/late for
 *      non-Turkish sites.
 *   2) Every raw-phone → hash transform in runtime code funnels through
 *      `lib/dic/phone-hash.ts` (`buildPhoneIdentity`). Parallel hashing
 *      paths would desync Enhanced Conversions identifiers between writes.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.git',
  'coverage',
  'dist',
  'build',
  '.turbo',
  '.vercel',
  'out',
  'docs',
  'scripts',
  'supabase',
  'tests',
  'public',
]);
const EXTENSIONS = new Set(['.ts', '.tsx']);

function walkRuntime(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkRuntime(full));
      continue;
    }
    const dot = entry.name.lastIndexOf('.');
    const ext = dot >= 0 ? entry.name.slice(dot) : '';
    if (!EXTENSIONS.has(ext)) continue;
    // Skip *.test.ts and *.spec.ts just in case any slipped into runtime dirs.
    if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.spec.ts')) continue;
    out.push(full);
  }
  return out;
}

function stripCommentsAndStrings(src: string): string {
  // Comment stripper — keep string literals but drop JS comments so we don't
  // false-positive on documentation mentions.
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1) Auto-junk timezone edge — cron must use UTC-only comparison
// ---------------------------------------------------------------------------

test('auto-junk cron compares expires_at against a UTC ISO timestamp', () => {
  const path = join(ROOT, 'app/api/cron/auto-junk/route.ts');
  assert.ok(existsSync(path), 'auto-junk cron route missing');
  const src = readFileSync(path, 'utf8');
  // Must use `new Date().toISOString()` (always UTC) not a locale-specific
  // format like `toLocaleString(..., { timeZone: 'Europe/Istanbul' })`.
  assert.match(
    src,
    /new Date\(\)\.toISOString\(\)/,
    'auto-junk must compute nowIso via toISOString() (UTC)'
  );
  const code = stripCommentsAndStrings(src);
  assert.ok(
    !/Europe\/Istanbul/.test(code),
    'auto-junk code must not reference Europe/Istanbul (would bias non-Turkish sites)'
  );
  assert.ok(
    !/toLocaleString\s*\(/.test(code),
    'auto-junk must not format time via toLocaleString (locale-dependent)'
  );
  // The eligibility condition must be a half-open < comparison so rows exactly
  // at the boundary are not both junked and kept depending on the run clock.
  assert.match(src, /\.lt\(\s*'expires_at'\s*,\s*nowIso\s*\)/, 'must use .lt (half-open) on expires_at');
});

test('auto-junk cron is site-scoped to bound blast radius', () => {
  const src = readFileSync(join(ROOT, 'app/api/cron/auto-junk/route.ts'), 'utf8');
  assert.match(
    src,
    /\.eq\(\s*'site_id'\s*,\s*siteId\s*\)/,
    'auto-junk update must be site-scoped — no unscoped UPDATE across tenants'
  );
  assert.match(
    src,
    /limit\(500\)/,
    'auto-junk must cap the site enumeration at 500 rows per run'
  );
});

// ---------------------------------------------------------------------------
// 2) Phone hash SSOT — only phone-hash.ts / identity-hash.ts own the transform
// ---------------------------------------------------------------------------

/**
 * Files that are allowed to import the low-level hashing primitives
 * (`hashPhoneForEC`, `sanitizePhoneForHash`) directly. Everyone else must go
 * through `buildPhoneIdentity` or `hashE164ForEnhancedConversions`.
 */
const ALLOWED_LOW_LEVEL_IMPORTERS = new Set<string>([
  'lib/dic/phone-hash.ts',
  'lib/dic/identity-hash.ts',
  'lib/dic/index.ts',
]);

test('only the DIC SSOT modules + documented exports import low-level phone hash primitives', () => {
  const files = walkRuntime(ROOT);
  const violators: string[] = [];
  const primitivePattern =
    /from ['"]@\/lib\/dic\/identity-hash['"]|hashPhoneForEC\s*\(|sanitizePhoneForHash\s*\(/;
  for (const file of files) {
    const rel = relative(ROOT, file).replace(/\\/g, '/');
    if (ALLOWED_LOW_LEVEL_IMPORTERS.has(rel)) continue;
    const src = readFileSync(file, 'utf8');
    if (primitivePattern.test(src)) {
      violators.push(rel);
    }
  }
  assert.equal(
    violators.length,
    0,
    `phone hash primitives used outside the SSOT. Route through buildPhoneIdentity() instead:\n${violators.join('\n')}`
  );
});

test('all seal / stage / intent-status write paths import buildPhoneIdentity', () => {
  const writePaths = [
    'app/api/calls/[id]/seal/route.ts',
    'app/api/intents/[id]/stage/route.ts',
  ];
  for (const p of writePaths) {
    const src = readFileSync(join(ROOT, p), 'utf8');
    assert.match(
      src,
      /from ['"]@\/lib\/dic\/phone-hash['"]/,
      `${p} must import buildPhoneIdentity SSOT`
    );
    assert.match(
      src,
      /buildPhoneIdentity\s*\(/,
      `${p} must call buildPhoneIdentity on raw phone input`
    );
  }
});

// ---------------------------------------------------------------------------
// 3) Phone hash helper itself reads the env salt only inside the SSOT
// ---------------------------------------------------------------------------

test('only phone-hash.ts feeds OCI_PHONE_HASH_SALT into a hash call', () => {
  const files = walkRuntime(ROOT);
  const offenders: string[] = [];
  for (const file of files) {
    const rel = relative(ROOT, file).replace(/\\/g, '/');
    if (rel === 'lib/dic/phone-hash.ts') continue;
    const src = readFileSync(file, 'utf8');
    const code = stripCommentsAndStrings(src);
    // A file is an offender only when it BOTH reads the salt env var AND
    // invokes a hashing primitive in the same module. Pure health checks
    // like `if (!process.env.OCI_PHONE_HASH_SALT) logError(...)` stay allowed.
    const readsSalt = /process\.env\.OCI_PHONE_HASH_SALT/.test(code);
    const hashes = /\bhashPhoneForEC\s*\(|\bsanitizePhoneForHash\s*\(/.test(code);
    if (readsSalt && hashes) offenders.push(rel);
  }
  assert.equal(
    offenders.length,
    0,
    `OCI_PHONE_HASH_SALT feeds a direct hash call outside phone-hash.ts:\n${offenders.join('\n')}`
  );
});

// Silence unused imports helper when walkRuntime returns nothing in edge cases.
void statSync;
