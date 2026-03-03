/**
 * Unit tests for lib/geo: CF over Vercel priority, strictGhostGeo, backward compatibility.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { extractGeoInfo, isGhostGeoCity } from '@/lib/geo';
import { NextRequest } from 'next/server';

function reqWithHeaders(headers: Record<string, string>): NextRequest {
  return new NextRequest('http://localhost/api/sync', {
    headers: new Headers(headers),
  });
}

test('extractGeoInfo: CF headers override Vercel when both present', () => {
  const req = reqWithHeaders({
    'cf-ipcity': 'Istanbul',
    'cf-ipcountry': 'TR',
    'x-vercel-ip-city': 'Rome',
    'x-vercel-ip-country': 'IT',
  });
  const { geoInfo } = extractGeoInfo(req, 'Mozilla/5.0', undefined);
  assert.equal(geoInfo.city, 'Istanbul', 'city must come from CF, not Vercel');
  assert.equal(geoInfo.country, 'TR', 'country must come from CF, not Vercel');
});

test('extractGeoInfo: strictGhostGeo true => Rome/Amsterdam/Roma become Unknown and district null', () => {
  const req = reqWithHeaders({
    'cf-ipcity': 'Rome',
    'cf-ipcountry': 'IT',
  });
  const { geoInfo } = extractGeoInfo(req, 'Mozilla/5.0', undefined, { strictGhostGeo: true });
  assert.equal(geoInfo.city, 'Unknown');
  assert.equal(geoInfo.district, null);
});

test('extractGeoInfo: strictGhostGeo true with Amsterdam (case-insensitive)', () => {
  const req = reqWithHeaders({
    'cf-ipcity': 'Amsterdam',
    'cf-ipcountry': 'NL',
  });
  const { geoInfo } = extractGeoInfo(req, 'Mozilla/5.0', undefined, { strictGhostGeo: true });
  assert.equal(geoInfo.city, 'Unknown');
  assert.equal(geoInfo.district, null);
});

test('extractGeoInfo: strictGhostGeo false/absent => backward compatible, Rome returned', () => {
  const req = reqWithHeaders({
    'cf-ipcity': 'Rome',
    'cf-ipcountry': 'IT',
  });
  const { geoInfo } = extractGeoInfo(req, 'Mozilla/5.0', undefined);
  assert.equal(geoInfo.city, 'Rome', 'omitted options preserves original city');
  const { geoInfo: geo2 } = extractGeoInfo(req, 'Mozilla/5.0', undefined, { strictGhostGeo: false });
  assert.equal(geo2.city, 'Rome', 'strictGhostGeo: false preserves original city');
});

test('extractGeoInfo: strictGhostGeo true => Rome/Amsterdam from meta become Unknown (backward compat)', () => {
  const { geoInfo } = extractGeoInfo(null, 'Mozilla/5.0', { city: 'Rome' } as import('@/lib/types/ingest').IngestMeta, { strictGhostGeo: true });
  assert.equal(geoInfo.city, 'Unknown', 'meta.city Rome with strictGhostGeo true => Unknown');
  assert.equal(geoInfo.district, null);
  const { geoInfo: geo2 } = extractGeoInfo(null, 'Mozilla/5.0', { city: 'Amsterdam' } as import('@/lib/types/ingest').IngestMeta, { strictGhostGeo: true });
  assert.equal(geo2.city, 'Unknown', 'meta.city Amsterdam with strictGhostGeo true => Unknown');
});

test('extractGeoInfo: strictGhostGeo false/omitted with meta.city => original city preserved', () => {
  const { geoInfo } = extractGeoInfo(null, 'Mozilla/5.0', { city: 'Rome' } as import('@/lib/types/ingest').IngestMeta);
  assert.equal(geoInfo.city, 'Rome', 'meta.city Rome without strictGhostGeo => Rome');
  const { geoInfo: geo2 } = extractGeoInfo(null, 'Mozilla/5.0', { city: 'Rome' } as import('@/lib/types/ingest').IngestMeta, { strictGhostGeo: false });
  assert.equal(geo2.city, 'Rome', 'meta.city Rome with strictGhostGeo false => Rome');
});

test('isGhostGeoCity: Rome, Amsterdam, Roma (case-insensitive) return true', () => {
  assert.equal(isGhostGeoCity('Rome'), true);
  assert.equal(isGhostGeoCity('rome'), true);
  assert.equal(isGhostGeoCity('Amsterdam'), true);
  assert.equal(isGhostGeoCity('Roma'), true);
  assert.equal(isGhostGeoCity('Istanbul'), false);
  assert.equal(isGhostGeoCity(null), false);
  assert.equal(isGhostGeoCity(''), false);
});

test('isGhostGeoCity: Düsseldorf, Ashburn, Frankfurt, London (CDN edge) return true', () => {
  assert.equal(isGhostGeoCity('Düsseldorf'), true);
  assert.equal(isGhostGeoCity('dusseldorf'), true);
  assert.equal(isGhostGeoCity('Ashburn'), true);
  assert.equal(isGhostGeoCity('Frankfurt'), true);
  assert.equal(isGhostGeoCity('London'), true);
});

test('extractGeoInfo: strictGhostGeo true => Düsseldorf/Ashburn become Unknown', () => {
  const req1 = reqWithHeaders({ 'cf-ipcity': 'Düsseldorf', 'cf-ipcountry': 'DE' });
  const { geoInfo: g1 } = extractGeoInfo(req1, 'Mozilla/5.0', undefined, { strictGhostGeo: true });
  assert.equal(g1.city, 'Unknown');
  const req2 = reqWithHeaders({ 'cf-ipcity': 'Ashburn', 'cf-ipcountry': 'US' });
  const { geoInfo: g2 } = extractGeoInfo(req2, 'Mozilla/5.0', undefined, { strictGhostGeo: true });
  assert.equal(g2.city, 'Unknown');
});
