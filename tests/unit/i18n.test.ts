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

test('resolveLocale: site > user > Accept-Language > default', () => {
  assert.equal(resolveLocale({ locale: 'tr-TR' }), 'tr-TR');
  assert.equal(resolveLocale(null, { locale: 'de-DE' }), 'de-DE');
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
