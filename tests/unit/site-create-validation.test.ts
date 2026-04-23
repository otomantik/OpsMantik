import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SITE_COUNTRY,
  DEFAULT_SITE_CURRENCY,
  DEFAULT_SITE_LOCALE,
  DEFAULT_SITE_TIMEZONE,
  parseCreateSitePayload,
} from '@/lib/validation/site-create';

test('parseCreateSitePayload normalizes and validates create payload', () => {
  const parsed = parseCreateSitePayload({
    name: 'Koç Oto Kurtarma',
    domain: 'https://www.kocotokurtarma.com/path',
    locale: 'tr-TR',
    default_country_iso: 'tr',
    timezone: 'Europe/Istanbul',
    currency: 'try',
  });

  assert.equal(parsed.name, 'Koç Oto Kurtarma');
  assert.equal(parsed.domain, 'www.kocotokurtarma.com');
  assert.equal(parsed.locale, 'tr-TR');
  assert.equal(parsed.default_country_iso, 'TR');
  assert.equal(parsed.timezone, 'Europe/Istanbul');
  assert.equal(parsed.currency, 'TRY');
});

test('parseCreateSitePayload applies defaults for optional fields', () => {
  const parsed = parseCreateSitePayload({
    name: 'Opsmantik Global',
    domain: 'opsmantik.com',
  });

  assert.equal(parsed.locale, DEFAULT_SITE_LOCALE);
  assert.equal(parsed.default_country_iso, DEFAULT_SITE_COUNTRY);
  assert.equal(parsed.timezone, DEFAULT_SITE_TIMEZONE);
  assert.equal(parsed.currency, DEFAULT_SITE_CURRENCY);
});

test('parseCreateSitePayload rejects invalid values', () => {
  assert.throws(
    () =>
      parseCreateSitePayload({
        name: 'A',
        domain: 'not valid domain ###',
        currency: 'invalid',
      }),
    /(Invalid|Too small)/
  );
});
