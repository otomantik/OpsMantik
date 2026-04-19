/**
 * Unit tests for the UI time formatter SSOT (Phase 5 f5-panel-locale).
 *
 * `formatTimestampInZone` is the canonical path for dashboard clock displays:
 * explicit timezone, fail-soft on invalid input, graceful fallback on bad tz.
 * `formatTimestamp` keeps its Europe/Istanbul default to stay byte-compatible
 * with the existing Turkish dashboards — call sites migrate piecewise to the
 * new helper as they adopt `useSiteTimezone()`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatTimestamp,
  formatTimestampInZone,
} from '@/lib/utils/formatting';

const ISO = '2026-04-19T10:00:00.000Z';

test('formatTimestamp keeps the Europe/Istanbul default for back-compat', () => {
  const out = formatTimestamp(ISO, { hour: '2-digit', minute: '2-digit' });
  assert.equal(out, '13:00', 'TRT is UTC+3 — 10:00Z must render as 13:00');
});

test('formatTimestamp option.timeZone override wins over the default', () => {
  const out = formatTimestamp(ISO, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });
  assert.equal(out, '10:00');
});

test('formatTimestamp returns em-dash on empty / invalid input', () => {
  assert.equal(formatTimestamp(null), '—');
  assert.equal(formatTimestamp(undefined), '—');
  assert.equal(formatTimestamp(''), '—');
  assert.equal(formatTimestamp('not-a-date'), '—');
});

test('formatTimestampInZone formats in the given IANA zone', () => {
  assert.equal(
    formatTimestampInZone(ISO, 'UTC', { hour: '2-digit', minute: '2-digit' }),
    '10:00'
  );
  assert.equal(
    formatTimestampInZone(ISO, 'Europe/Istanbul', { hour: '2-digit', minute: '2-digit' }),
    '13:00'
  );
  assert.equal(
    formatTimestampInZone(ISO, 'America/New_York', { hour: '2-digit', minute: '2-digit' }),
    '06:00',
    'EDT is UTC-4 — 10:00Z must render as 06:00'
  );
});

test('formatTimestampInZone falls back to UTC when timezone is blank', () => {
  assert.equal(
    formatTimestampInZone(ISO, '', { hour: '2-digit', minute: '2-digit' }),
    '10:00'
  );
  assert.equal(
    formatTimestampInZone(ISO, '   ', { hour: '2-digit', minute: '2-digit' }),
    '10:00'
  );
});

test('formatTimestampInZone falls back to the supplied fallback zone when tz is invalid', () => {
  const out = formatTimestampInZone(
    ISO,
    'Not/AValidZone',
    { hour: '2-digit', minute: '2-digit' },
    'Europe/Istanbul'
  );
  assert.equal(out, '13:00', 'invalid tz must fall back to Europe/Istanbul here, not UTC');
});

test('formatTimestampInZone returns em-dash on empty / invalid input', () => {
  assert.equal(formatTimestampInZone(null, 'UTC'), '—');
  assert.equal(formatTimestampInZone(undefined, 'UTC'), '—');
  assert.equal(formatTimestampInZone('', 'UTC'), '—');
  assert.equal(formatTimestampInZone('garbage', 'UTC'), '—');
});

test('formatTimestampInZone preserves custom option fields beyond timeZone', () => {
  const out = formatTimestampInZone(ISO, 'UTC', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // en-GB locale renders DD/MM/YYYY.
  assert.equal(out, '19/04/2026');
});
