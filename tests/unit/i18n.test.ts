/**
 * Unit tests for i18n core: currency, timezone, locale, translation.
 * Guard: ensure runtime code does not reintroduce TRY fallback or Europe/Istanbul hardcoding.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeCurrency,
  resolveCurrency,
  formatMoneyFromCents,
} from '@/lib/i18n/currency';
import { normalizeTimezone, resolveTimezone } from '@/lib/i18n/timezone';
import { normalizeLocale, resolveLocale } from '@/lib/i18n/locale';
import { translate } from '@/lib/i18n/t';
import { tr } from '@/lib/i18n/messages/tr';

// --- Currency ---

test('normalizeCurrency: valid 3-letter codes', () => {
  assert.equal(normalizeCurrency('USD'), 'USD');
  assert.equal(normalizeCurrency('try'), 'TRY');
  assert.equal(normalizeCurrency('eur'), 'EUR');
});

test('normalizeCurrency: invalid returns fallback', () => {
  assert.equal(normalizeCurrency(''), 'USD');
  assert.equal(normalizeCurrency('XX'), 'USD');
  assert.equal(normalizeCurrency('US'), 'USD');
  assert.equal(normalizeCurrency(null), 'USD');
  assert.equal(normalizeCurrency(undefined), 'USD');
  assert.equal(normalizeCurrency('US', 'EUR'), 'EUR');
  assert.equal(normalizeCurrency('TOOLONG', 'EUR'), 'EUR');
});

test('formatMoneyFromCents: formats correctly', () => {
  assert.ok(formatMoneyFromCents(1000, 'USD', 'en-US').includes('10'));
  assert.ok(formatMoneyFromCents(0, 'USD', 'en-US').includes('0'));
  assert.equal(formatMoneyFromCents(null, 'USD'), '-');
  assert.equal(formatMoneyFromCents(NaN, 'USD'), '-');
});

test('resolveCurrency: from site', () => {
  assert.equal(resolveCurrency({ currency: 'EUR' }), 'EUR');
  assert.equal(resolveCurrency({ currency: 'TRY' }), 'TRY');
  assert.equal(resolveCurrency({ config: { currency: 'GBP' } }), 'GBP');
  assert.equal(resolveCurrency({}), 'USD');
  assert.equal(resolveCurrency(null), 'USD');
});

// --- Timezone ---

test('normalizeTimezone: valid IANA', () => {
  assert.equal(normalizeTimezone('Europe/Istanbul'), 'Europe/Istanbul');
  assert.equal(normalizeTimezone('UTC'), 'UTC');
  assert.equal(normalizeTimezone('America/New_York'), 'America/New_York');
});

test('normalizeTimezone: invalid returns fallback', () => {
  assert.equal(normalizeTimezone(''), 'UTC');
  assert.equal(normalizeTimezone('invalid'), 'UTC');
  assert.equal(normalizeTimezone(null), 'UTC');
  assert.equal(normalizeTimezone('Europe', 'UTC'), 'UTC');
});

test('resolveTimezone: from site', () => {
  assert.equal(resolveTimezone({ timezone: 'Europe/Istanbul' }), 'Europe/Istanbul');
  assert.equal(resolveTimezone({ timezone: 'America/Los_Angeles' }), 'America/Los_Angeles');
  assert.equal(resolveTimezone({}), 'UTC');
  assert.equal(resolveTimezone(null), 'UTC');
});

// --- Locale ---

test('normalizeLocale: valid BCP-47', () => {
  assert.equal(normalizeLocale('en-US'), 'en-US');
  assert.equal(normalizeLocale('tr-TR'), 'tr-TR');
});

test('normalizeLocale: invalid returns fallback', () => {
  assert.equal(normalizeLocale(''), 'en-US');
  assert.equal(normalizeLocale(null), 'en-US');
});

test('resolveLocale: cookie > site > user > Accept-Language > default', () => {
  assert.equal(resolveLocale(null, null, null, 'tr'), 'tr-TR');
  assert.equal(resolveLocale({ locale: 'tr-TR' }, null, null, null), 'tr-TR');
  assert.equal(resolveLocale(null, { locale: 'de-DE' }, null, null), 'de-DE');
  assert.equal(resolveLocale(null, null, 'tr,en;q=0.9'), 'tr-TR');
  assert.equal(resolveLocale(null, null, 'en,tr;q=0.9'), 'en-US');
  assert.equal(resolveLocale(null, null, null), 'en-US');
});

// --- Translation fallback ---

test('translate: exact locale match', () => {
  assert.equal(translate('sidebar.operationsCenter', 'en'), 'Operations Center');
  assert.equal(translate('sidebar.operationsCenter', 'tr'), 'Operasyon Merkezi');
});

test('translate: locale prefix fallback (tr-TR -> tr)', () => {
  assert.equal(translate('sidebar.operationsCenter', 'tr-TR'), 'Operasyon Merkezi');
});

test('translate: fallback to en when key missing in locale', () => {
  const key = 'sidebar.operationsCenter';
  assert.equal(translate(key, 'de'), 'Operations Center');
});

test('translate: fallback to key when missing everywhere', () => {
  assert.equal(translate('unknown.key.xyz', 'en'), 'unknown.key.xyz');
});

test('translate: never throws', () => {
  assert.doesNotThrow(() => translate('', 'en'));
  assert.doesNotThrow(() => translate('x', 'zz', { a: 1 }));
});

// --- Guard: no TRY/Europe/Istanbul hardcoding in i18n core ---
test('guard: resolveCurrency default is USD not TRY', () => {
  assert.equal(resolveCurrency(null), 'USD');
  assert.equal(resolveCurrency({}), 'USD');
  assert.notEqual(resolveCurrency(null), 'TRY');
});

test('guard: resolveTimezone default is UTC not Europe/Istanbul', () => {
  assert.equal(resolveTimezone(null), 'UTC');
  assert.equal(resolveTimezone({}), 'UTC');
  assert.notEqual(resolveTimezone(null), 'Europe/Istanbul');
});

// --- i18n unification: locale purity ---

const ENGLISH_KPI_LABELS = [
  'Capture',
  'Shield',
  'Efficiency',
  'OCI ACTIVE',
  'LATENCY',
  'Traffic Sources',
  'Revenue Projection',
  'Conversion Pulse',
  'Activity Log',
];
const KPI_KEYS = [
  'kpi.capture',
  'kpi.shield',
  'kpi.efficiency',
  'statusBar.ociActive',
  'statusBar.latency',
  'traffic.title',
  'pulse.revenueProjection',
  'pulse.conversionPulse',
  'dashboard.activityLog',
];
const TURKISH_CHARS = /[şğıİöüçÇ]/;

test('tr-TR: no known English KPI labels appear', () => {
  for (const key of KPI_KEYS) {
    const value = translate(key, 'tr-TR');
    for (const eng of ENGLISH_KPI_LABELS) {
      assert.ok(!value.includes(eng), `tr-TR should not render "${eng}" for ${key}, got: ${value}`);
    }
  }
});

test('en-US: no Turkish KPI labels (no Turkish chars in KPI/status keys)', () => {
  for (const key of KPI_KEYS) {
    const value = translate(key, 'en-US');
    assert.ok(!TURKISH_CHARS.test(value), `en-US should not render Turkish chars for ${key}, got: ${value}`);
  }
});

test('tr messages: at least one contains Turkish UTF-8 chars (ş, ğ, ı, İ, ö, ü)', () => {
  const values = Object.values(tr);
  const hasTurkish = values.some((v) => /[şğıİöü]/.test(v));
  assert.ok(hasTurkish, 'Turkish messages must contain at least one of: ş, ğ, ı, İ, ö, ü');
});
