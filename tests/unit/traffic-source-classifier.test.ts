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
  assert.ok(cardSrc.includes("attribution.includes('ads assisted')"), 'hunter card must treat Ads Assisted as Google Ads-compatible source evidence');
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
    join(ROOT, 'supabase', 'migrations', '20261108190000_intent_source_geo_hardening.sql'),
    'utf8'
  );
  assert.ok(migrationSrc.includes("c.location_source = 'gclid'"), 'migration must preserve gclid-origin location marker');
  assert.ok(migrationSrc.includes('c.district_name'), 'migration must prefer ads-resolved district_name');
  assert.ok(migrationSrc.includes('s.geo_district'), 'migration must fallback to session geo master field before raw district');
});
