import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { determineTrafficSource } from '@/lib/analytics/source-classifier';

const ROOT = process.cwd();

test('detects Google Ads from click ids and Ads Assisted fallbacks remain representable in UI contracts', () => {
  const out = determineTrafficSource('https://example.com/?gclid=abc1234567890', '', {});
  assert.equal(out.traffic_source, 'Google Ads');
  assert.equal(out.traffic_medium, 'cpc');

  const cardSrc = readFileSync(join(ROOT, 'components', 'dashboard', 'hunter-card.tsx'), 'utf8');
  assert.ok(cardSrc.includes('/ads[\\s-]*assisted/'), 'hunter card must treat Ads Assisted variants as Google Ads-compatible source evidence');
});

test('maps paid social UTMs to user-friendly paid platforms', () => {
  assert.deepEqual(
    determineTrafficSource('https://example.com/?utm_source=facebook&utm_medium=cpc', '', {}),
    { traffic_source: 'Facebook Ads', traffic_medium: 'cpc' }
  );
  assert.deepEqual(
    determineTrafficSource('https://example.com/?utm_source=instagram&utm_medium=paid_social', '', {}),
    { traffic_source: 'Instagram Ads', traffic_medium: 'cpc' }
  );
  assert.deepEqual(
    determineTrafficSource('https://example.com/?utm_source=tiktok&utm_medium=cpc', '', {}),
    { traffic_source: 'TikTok Ads', traffic_medium: 'cpc' }
  );
});

test('keeps SEO, referral, and direct deterministic', () => {
  assert.deepEqual(
    determineTrafficSource('https://example.com/', 'https://www.google.com/search?q=test', {}),
    { traffic_source: 'SEO', traffic_medium: 'organic', label: 'Google' }
  );
  assert.deepEqual(
    determineTrafficSource('https://example.com/', 'https://partner-site.example/path', {}),
    { traffic_source: 'Referral', traffic_medium: 'referral', label: 'partner-site.example' }
  );
  assert.deepEqual(
    determineTrafficSource('https://example.com/', '', {}),
    { traffic_source: 'Direct', traffic_medium: 'direct' }
  );
});

test('intent geo migrations prefer call district_name and session geo_district over plain IP district', () => {
  const migrationSrc = readFileSync(
    join(ROOT, 'supabase', 'migrations', '20260501191000_intents_lite_geo_ssot_unification.sql'),
    'utf8'
  );
  assert.ok(migrationSrc.includes('get_recent_intents_lite_v1'), 'migration must define intents lite RPC');
  assert.ok(migrationSrc.includes('coalesce(s.geo_district, s.district) AS district'), 'district must prefer geo_district over legacy district');
  assert.ok(migrationSrc.includes('coalesce(s.geo_city, s.city) AS city'), 'city must prefer geo_city over legacy city');
});
