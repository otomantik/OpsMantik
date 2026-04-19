/**
 * Phase 4 guard — f4-global-hardcodes.
 *
 * The system is going global. TR / TRY / Europe/Istanbul are legitimate values
 * for Turkish customers, but they MUST come from `sites.currency` and
 * `sites.timezone`, never from code-level fallbacks that silently re-bias the
 * whole pipeline toward Turkey.
 *
 * Invariants pinned here:
 *   1) `resolveSiteLocale` returns neutral UTC/USD when fed empty input.
 *   2) `assertSiteLocale` throws in production when site has missing/invalid locale.
 *   3) No data-pipeline runtime file contains the hardcoded string `'TRY'`
 *      as a ||/?? default. The site value is the SSOT.
 *   4) No data-pipeline runtime file contains the hardcoded string
 *      `'Europe/Istanbul'` as a ||/?? default.
 *   5) The strict CHECK migration is in place.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// 1) resolveSiteLocale returns neutral UTC/USD when fed empty input
// ---------------------------------------------------------------------------
test('resolveSiteLocale returns neutral UTC/USD for empty input', async () => {
  const mod = await import('@/lib/i18n/site-locale');
  assert.deepEqual(mod.resolveSiteLocale(null), { currency: 'USD', timezone: 'UTC' });
  assert.deepEqual(mod.resolveSiteLocale(undefined), { currency: 'USD', timezone: 'UTC' });
  assert.deepEqual(mod.resolveSiteLocale({}), { currency: 'USD', timezone: 'UTC' });
  assert.deepEqual(
    mod.resolveSiteLocale({ currency: '   ', timezone: '' }),
    { currency: 'USD', timezone: 'UTC' }
  );
});

test('resolveSiteLocale preserves valid site values', async () => {
  const mod = await import('@/lib/i18n/site-locale');
  assert.deepEqual(
    mod.resolveSiteLocale({ currency: 'TRY', timezone: 'Europe/Istanbul' }),
    { currency: 'TRY', timezone: 'Europe/Istanbul' }
  );
  assert.deepEqual(
    mod.resolveSiteLocale({ currency: 'eur', timezone: 'Europe/Berlin' }),
    { currency: 'EUR', timezone: 'Europe/Berlin' }
  );
});

// ---------------------------------------------------------------------------
// 2) assertSiteLocale throws in production when invalid
// ---------------------------------------------------------------------------
test('assertSiteLocale throws in production when currency is missing', async () => {
  const prev = process.env.NODE_ENV;
  try {
    (process.env as unknown as Record<string, string>).NODE_ENV = 'production';
    const mod = await import('@/lib/i18n/site-locale');
    assert.throws(
      () => mod.assertSiteLocale({ timezone: 'UTC' }, 'unit-test'),
      /SITE_LOCALE_INVALID_CURRENCY/
    );
  } finally {
    (process.env as unknown as Record<string, string>).NODE_ENV = prev ?? 'test';
  }
});

test('assertSiteLocale throws in production when timezone is missing', async () => {
  const prev = process.env.NODE_ENV;
  try {
    (process.env as unknown as Record<string, string>).NODE_ENV = 'production';
    const mod = await import('@/lib/i18n/site-locale');
    assert.throws(
      () => mod.assertSiteLocale({ currency: 'USD' }, 'unit-test'),
      /SITE_LOCALE_INVALID_TIMEZONE/
    );
  } finally {
    (process.env as unknown as Record<string, string>).NODE_ENV = prev ?? 'test';
  }
});

// ---------------------------------------------------------------------------
// 3) + 4) Runtime code scan for banned literal TR-biased fallbacks
// ---------------------------------------------------------------------------

/**
 * Data-pipeline runtime files that must NOT contain a fallback to 'TRY'.
 * UI components under `components/` and legacy TRT time helpers under
 * `lib/time/today-range.ts` / `lib/utils/formatting.ts` are addressed separately
 * by f5-panel-locale and are out of scope for this guard.
 */
const SCANNED_FILES: string[] = [
  'lib/oci/site-export-config.ts',
  'lib/oci/oci-config.ts',
  'lib/oci/enqueue-seal-conversion.ts',
  'lib/oci/maintenance/run-maintenance.ts',
  'app/api/calls/[id]/seal/route.ts',
  'app/api/cron/oci/process-outbox-events/route.ts',
  'app/api/intents/[id]/stage/route.ts',
  'app/api/sales/route.ts',
  'app/api/cron/sweep-unsent-conversions/route.ts',
  'lib/domain/mizan-mantik/orchestrator.ts',
  'lib/domain/mizan-mantik/value-config.ts',
  'lib/utils/format-google-ads-time.ts',
];

/**
 * Patterns that represent the bug: falling back to a Turkey-specific value when a
 * site value is missing. We accept the literal appearing inside comments or JSDoc.
 */
const TR_FALLBACK_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "|| 'TRY'", re: /\|\|\s*['"]TRY['"]/ },
  { name: "?? 'TRY'", re: /\?\?\s*['"]TRY['"]/ },
  { name: "|| 'Europe/Istanbul'", re: /\|\|\s*['"]Europe\/Istanbul['"]/ },
  { name: "?? 'Europe/Istanbul'", re: /\?\?\s*['"]Europe\/Istanbul['"]/ },
];

function stripCommentsAndStrings(src: string): string {
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

test('no runtime data-pipeline file falls back to TR-biased defaults', () => {
  const violations: string[] = [];
  for (const rel of SCANNED_FILES) {
    const full = join(ROOT, rel);
    if (!existsSync(full)) {
      violations.push(`${rel}: file not found (did it move?)`);
      continue;
    }
    const raw = readFileSync(full, 'utf8');
    const code = stripCommentsAndStrings(raw);
    for (const { name, re } of TR_FALLBACK_PATTERNS) {
      if (re.test(code)) {
        violations.push(`${rel}: contains TR-biased fallback ${name}`);
      }
    }
  }
  assert.equal(
    violations.length,
    0,
    `Turkey-biased fallbacks leaked back into runtime code:\n${violations.join('\n')}`
  );
});

// ---------------------------------------------------------------------------
// 5) Strict CHECK migration exists
// ---------------------------------------------------------------------------
test('sites locale strict CHECK migration is committed', () => {
  const migration = join(ROOT, 'supabase', 'migrations', '20260419200000_sites_locale_strict_check.sql');
  assert.ok(existsSync(migration), `missing migration: ${migration}`);
  const src = readFileSync(migration, 'utf8');
  assert.ok(/sites_currency_iso4217_chk/.test(src), 'currency CHECK missing');
  assert.ok(/sites_timezone_iana_chk/.test(src), 'timezone CHECK missing');
  assert.ok(/CHECK\s*\(currency\s*~\s*'\^\[A-Z\]\{3\}\$'/.test(src), 'currency regex CHECK not strict');
});

// ---------------------------------------------------------------------------
// 6) Defaults in SiteExportConfigSchema are neutral USD/UTC
// ---------------------------------------------------------------------------
test('SiteExportConfig defaults are neutral (USD/UTC)', async () => {
  const mod = await import('@/lib/oci/site-export-config');
  assert.equal(mod.DEFAULT_SITE_EXPORT_CONFIG.currency, 'USD');
  assert.equal(mod.DEFAULT_SITE_EXPORT_CONFIG.timezone, 'UTC');
  const parsed = mod.parseExportConfig({});
  assert.equal(parsed.currency, 'USD');
  assert.equal(parsed.timezone, 'UTC');
});
