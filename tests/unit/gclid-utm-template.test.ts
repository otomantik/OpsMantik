/**
 * GCLID + Google Ads tam tracking şablonu: tüm parametrelerin yakalanması.
 * Template: utm_source, utm_medium, utm_campaign, utm_adgroup, utm_content, utm_term,
 * device, devicemodel, targetid, network, adposition, feeditemid,
 * loc_interest_ms, loc_physical_ms, matchtype, gclid, wbraid, gbraid
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractUTM, computeAttribution } from '@/lib/attribution';

const BASE = 'https://example.com/landing';

test('extractUTM: full template in query string — tüm parametreler yakalanır', () => {
  const url = BASE + '?' + [
    'utm_source=google',
    'utm_medium=cpc',
    'utm_campaign=123',
    'utm_adgroup=456',
    'utm_content=creative1',
    'utm_term=keyword',
    'device=mobile',
    'devicemodel=iPhone14',
    'targetid=789',
    'network=Search',
    'adposition=1',
    'feeditemid=feed1',
    'loc_interest_ms=12345',
    'loc_physical_ms=67890',
    'matchtype=e',
    'gclid=abc123',
    'wbraid=wbr_xyz',
    'gbraid=gbr_xyz',
  ].join('&');

  const utm = extractUTM(url);
  assert.ok(utm, 'extractUTM returns object for full template URL');

  assert.equal(utm!.source, 'google');
  assert.equal(utm!.medium, 'cpc');
  assert.equal(utm!.campaign, '123');
  assert.equal(utm!.adgroup, '456');
  assert.equal(utm!.content, 'creative1');
  assert.equal(utm!.term, 'keyword');
  assert.equal(utm!.matchtype, 'e');
  assert.equal(utm!.device, 'mobile');
  assert.equal(utm!.device_model, 'iPhone14');
  assert.equal(utm!.target_id, '789');
  assert.equal(utm!.network, 'Search');
  assert.equal(utm!.adposition, '1');
  assert.equal(utm!.feed_item_id, 'feed1');
  assert.equal(utm!.loc_interest_ms, '12345');
  assert.equal(utm!.loc_physical_ms, '67890');

  // gclid/wbraid/gbraid URL'de var ama extractUTM sadece UTM/ads alanlarını döner (click id'ler ayrı okunur)
  assert.ok(!('gclid' in (utm as Record<string, unknown>)), 'extractUTM does not return gclid (handled separately)');
});

test('extractUTM: hash fragment içindeki parametreler yakalanır', () => {
  const url = 'https://example.com/?gclid=xyz#?utm_term=keyword&matchtype=p&utm_source=google';
  const utm = extractUTM(url);
  assert.ok(utm);
  assert.equal(utm!.term, 'keyword');
  assert.equal(utm!.matchtype, 'p');
  assert.equal(utm!.source, 'google');
});

test('extractUTM: hash ile prefix (4?utm_term=x) formatı yakalanır', () => {
  const url = 'https://example.com/?gclid=abc#4?utm_term=kw&matchtype=e';
  const utm = extractUTM(url);
  assert.ok(utm);
  assert.equal(utm!.term, 'kw');
  assert.equal(utm!.matchtype, 'e');
});

test('extractUTM: sadece UTM/ads parametreleri yoksa null döner', () => {
  const urlOnlyGclid = BASE + '?gclid=abc123';
  assert.equal(extractUTM(urlOnlyGclid), null, 'URL with only gclid returns null (no utm/ads params)');

  const urlEmpty = BASE;
  assert.equal(extractUTM(urlEmpty), null, 'URL with no params returns null');
});

test('computeAttribution: gclid varsa First Click (Paid)', () => {
  const r = computeAttribution({ gclid: 'abc123' });
  assert.equal(r.source, 'First Click (Paid)');
  assert.equal(r.isPaid, true);
});

test('computeAttribution: gclid yok utm_medium=cpc ise Paid (UTM)', () => {
  const r = computeAttribution({
    utm: { source: 'google', medium: 'cpc', campaign: '123' },
  });
  assert.equal(r.source, 'Paid (UTM)');
  assert.equal(r.isPaid, true);
});

test('extractUTM: placement ve adposition ayrı ayrı yakalanır', () => {
  const url = BASE + '?placement=display_placement&adposition=2';
  const utm = extractUTM(url);
  assert.ok(utm);
  assert.equal(utm!.placement, 'display_placement');
  assert.equal(utm!.adposition, '2');
});

test('extractUTM: geçersiz URL null döner', () => {
  assert.equal(extractUTM('not-a-url'), null);
  assert.equal(extractUTM(''), null);
});
