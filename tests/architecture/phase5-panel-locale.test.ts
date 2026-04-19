/**
 * Phase 5 — panel locale + site timezone clock binding pins.
 *
 * Invariants:
 *   1) `SiteLocaleProvider` + `useSiteLocale` / `useSiteTimezone` live in
 *      `components/context/site-locale-context.tsx` with neutral UTC / USD /
 *      en-US defaults (matches lib/i18n/site-locale SSOT).
 *   2) The provider is wired into the main dashboard page so every
 *      descendant has the active site's timezone available.
 *   3) `LiveClock` — the single wall-clock in the header — renders using
 *      `useSiteTimezone`, not a hardcoded zone.
 *   4) `lib/utils/formatting.ts` exposes the explicit
 *      `formatTimestampInZone(ts, tz, options?)` SSOT for Phase 5 migrations.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// 1) Context module contract
// ---------------------------------------------------------------------------

test('site-locale-context exports the provider + hooks with neutral defaults', () => {
  const path = join(ROOT, 'components/context/site-locale-context.tsx');
  assert.ok(existsSync(path), 'context module must exist');
  const src = readFileSync(path, 'utf8');
  assert.match(src, /export function SiteLocaleProvider/, 'provider missing');
  assert.match(src, /export function useSiteLocale/, 'useSiteLocale hook missing');
  assert.match(src, /export function useSiteTimezone/, 'useSiteTimezone hook missing');
  // Neutral defaults must come from the shared SSOT so code + UI never drift
  // apart on what "no site configured yet" means.
  assert.match(
    src,
    /NEUTRAL_TIMEZONE/,
    'context must import NEUTRAL_TIMEZONE from lib/i18n/site-locale'
  );
  assert.match(
    src,
    /NEUTRAL_CURRENCY/,
    'context must import NEUTRAL_CURRENCY from lib/i18n/site-locale'
  );
  assert.match(
    src,
    /export const NEUTRAL_UI_LOCALE\s*=\s*'en-US'/,
    'UI locale default must be en-US'
  );
});

// ---------------------------------------------------------------------------
// 2) Dashboard wiring
// ---------------------------------------------------------------------------

test('site dashboard page wraps children in SiteLocaleProvider fed from sites row', () => {
  const path = join(ROOT, 'app/dashboard/site/[siteId]/page.tsx');
  const src = readFileSync(path, 'utf8');
  assert.match(
    src,
    /from ['"]@\/components\/context\/site-locale-context['"]/,
    'page must import SiteLocaleProvider'
  );
  assert.match(src, /<SiteLocaleProvider\b/, 'page must render <SiteLocaleProvider>');
  // Must pass the authoritative triple so the provider rehydrates to the
  // real site — passing an empty object would silently fall back to neutral
  // defaults and hide misconfigurations.
  assert.match(src, /timezone:\s*site\.timezone/, 'provider value must include site.timezone');
  assert.match(src, /currency:\s*site\.currency/, 'provider value must include site.currency');
  assert.match(src, /locale:\s*site\.locale/, 'provider value must include site.locale');
  // Those fields have to be selected from the sites row up front.
  assert.match(
    src,
    /\.select\([^)]*currency[^)]*timezone[^)]*locale[^)]*\)/,
    'sites select must load currency, timezone, and locale for the provider'
  );
});

// ---------------------------------------------------------------------------
// 3) LiveClock reads site timezone
// ---------------------------------------------------------------------------

test('LiveClock uses useSiteTimezone instead of a hardcoded zone', () => {
  const path = join(ROOT, 'components/dashboard/live-clock.tsx');
  const src = readFileSync(path, 'utf8');
  assert.match(
    src,
    /from ['"]@\/components\/context\/site-locale-context['"]/,
    'LiveClock must import from the site-locale-context'
  );
  assert.match(src, /useSiteTimezone\s*\(\s*\)/, 'LiveClock must call useSiteTimezone()');
  assert.match(
    src,
    /timeZone:\s*siteTimezone/,
    'toLocaleTimeString must receive the resolved site timezone'
  );
  // No Turkey-specific literal is allowed to sneak back in.
  assert.ok(
    !/Europe\/Istanbul/.test(src),
    'LiveClock must not reference Europe/Istanbul directly'
  );
});

// ---------------------------------------------------------------------------
// 4) formatTimestampInZone SSOT
// ---------------------------------------------------------------------------

test('HunterCard threads the active site timezone into its time display', () => {
  const src = readFileSync(
    join(ROOT, 'components/dashboard/hunter-card.tsx'),
    'utf8'
  );
  assert.match(
    src,
    /from ['"]@\/components\/context\/site-locale-context['"]/,
    'HunterCard must import from site-locale-context'
  );
  assert.match(src, /useSiteTimezone\s*\(\s*\)/, 'HunterCard must call useSiteTimezone()');
  assert.ok(
    !/timeZone:\s*['"]Europe\/Istanbul['"]/.test(src),
    'HunterCard must not hardcode Europe/Istanbul'
  );
});

test('no dashboard component hardcodes timeZone: "Europe/Istanbul"', () => {
  // Sweep components/ for the pattern. We accept references inside comments
  // but not active toLocaleTimeString / toLocaleString calls.
  const fs = require('node:fs') as typeof import('node:fs');
  const path = require('node:path') as typeof import('node:path');
  const base = path.join(ROOT, 'components');
  const offenders: string[] = [];

  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.tsx') && !entry.name.endsWith('.ts')) continue;
      const src = fs.readFileSync(full, 'utf8');
      // Strip line comments for a cleaner check; block comments are rare in TSX.
      const code = src.replace(/\/\/[^\n]*/g, '');
      if (/timeZone\s*:\s*['"]Europe\/Istanbul['"]/.test(code)) {
        offenders.push(path.relative(ROOT, full).replace(/\\/g, '/'));
      }
    }
  }
  walk(base);

  assert.equal(
    offenders.length,
    0,
    `dashboard components must thread the active site timezone via useSiteTimezone(), not hardcode Europe/Istanbul. Offenders:\n${offenders.join('\n')}`
  );
});

test('lib/utils/formatting.ts exposes formatTimestampInZone with the expected signature', () => {
  const src = readFileSync(join(ROOT, 'lib/utils/formatting.ts'), 'utf8');
  assert.match(
    src,
    /export function formatTimestampInZone\s*\(/,
    'formatTimestampInZone must be exported'
  );
  // Signature pin: `(ts, timeZone, options?, fallbackTimeZone?)`
  assert.match(
    src,
    /formatTimestampInZone\(\s*\n?\s*ts:[^,]+,\s*\n?\s*timeZone:[^,]+,\s*\n?\s*options\?:[^,]+,\s*\n?\s*fallbackTimeZone:/,
    'formatTimestampInZone signature drifted — update tests/docs if intentional'
  );
});
