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
  assert.equal(geoInfo.city, 'Rome');
  const { geoInfo: geo2 } = extractGeoInfo(req, 'Mozilla/5.0', undefined, { strictGhostGeo: false });
  assert.equal(geo2.city, 'Rome');
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
