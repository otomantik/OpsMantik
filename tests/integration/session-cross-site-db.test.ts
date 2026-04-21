/**
 * PR-T1.7 — DB-backed session tenant-boundary guard.
 * Asserts: SessionService must not read or mutate a foreign-site session when the same client sid is reused.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from 'dotenv';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { adminClient } from '@/lib/supabase/admin';
import { SessionService } from '@/lib/services/session-service';
import { requireStrictEnv } from '@/tests/helpers/strict-ingest-helpers';
import { currentMonthStartIsoDate, resolveTwoDistinctSites } from '@/tests/helpers/tenant-boundary-helpers';

config({ path: join(process.cwd(), '.env.local') });

test('SessionService: foreign-site client sid does not reuse or mutate another tenant session', async (t) => {
  const env = requireStrictEnv();
  if (env.skip) {
    t.skip(env.reason);
    return;
  }

  const sites = await resolveTwoDistinctSites();
  if (!sites) {
    t.skip('At least two site rows are required for cross-site session integration test');
    return;
  }

  const { siteA, siteB } = sites;
  const sharedSid = randomUUID();
  const createdMonth = currentMonthStartIsoDate();

  const { data: foreignSession, error: foreignInsertError } = await adminClient
    .from('sessions')
    .insert({
      id: sharedSid,
      site_id: siteA,
      created_month: createdMonth,
      entry_page: 'https://example.com/site-a',
      attribution_source: 'Organic',
      gclid: null,
    })
    .select('id, site_id, created_month, entry_page, attribution_source, gclid')
    .single();

  if (foreignInsertError || !foreignSession?.id) {
    t.skip(`Could not insert foreign-site session fixture: ${foreignInsertError?.message ?? 'no data'}`);
    return;
  }

  t.after(async () => {
    await adminClient.from('events').delete().eq('session_id', sharedSid).eq('session_month', createdMonth);
    await adminClient.from('sessions').delete().eq('id', sharedSid).eq('created_month', createdMonth);
  });

  const handled = await SessionService.handleSession(
    siteB,
    createdMonth,
    {
      client_sid: sharedSid,
      url: 'https://example.com/site-b?gclid=SAFECLICK123',
      currentGclid: 'SAFECLICK123',
      meta: { fp: `fp-${randomUUID()}` },
      params: new URL('https://example.com/site-b?gclid=SAFECLICK123').searchParams,
      attributionSource: 'First Click (Paid)',
      deviceType: 'desktop',
      fingerprint: `fp-${randomUUID()}`,
      referrer: 'https://google.com/',
      utm: { source: 'google', medium: 'cpc', campaign: 'tenant-guard' },
      consent_scopes: ['analytics'],
    },
    {
      ip: '203.0.113.10',
      userAgent: 'tenant-boundary-test',
      geoInfo: {
        city: 'Istanbul',
        district: 'Kadikoy',
        country: 'TR',
        timezone: 'Europe/Istanbul',
        telco_carrier: null,
        isp_asn: null,
        is_proxy_detected: false,
      },
      deviceInfo: {
        device_type: 'desktop',
        os: 'Windows',
        browser: 'Chrome',
        browser_version: '124.0.0.0',
        browser_language: 'tr-TR',
        device_memory: 8,
        hardware_concurrency: 4,
        screen_width: 1440,
        screen_height: 900,
        pixel_ratio: 1,
        gpu_renderer: 'Test GPU',
      },
    }
  );

  assert.ok(handled?.id, 'SessionService must return a session');
  assert.notEqual(handled.id, sharedSid, 'foreign-site sid collision must not reuse the foreign session id');

  t.after(async () => {
    await adminClient
      .from('events')
      .delete()
      .eq('session_id', handled.id)
      .eq('session_month', createdMonth);
    await adminClient
      .from('sessions')
      .delete()
      .eq('id', handled.id)
      .eq('created_month', createdMonth);
  });

  const { data: siteASessionAfter } = await adminClient
    .from('sessions')
    .select('id, site_id, entry_page, attribution_source, gclid')
    .eq('id', sharedSid)
    .eq('site_id', siteA)
    .eq('created_month', createdMonth)
    .single();

  assert.equal(siteASessionAfter?.entry_page, 'https://example.com/site-a', 'foreign tenant session must remain unchanged');
  assert.equal(siteASessionAfter?.attribution_source, 'Organic', 'foreign tenant attribution must remain unchanged');
  assert.equal(siteASessionAfter?.gclid, null, 'foreign tenant click id must remain unchanged');

  const { data: siteBSession } = await adminClient
    .from('sessions')
    .select('id, site_id, attribution_source, gclid')
    .eq('id', handled.id)
    .eq('site_id', siteB)
    .eq('created_month', createdMonth)
    .single();

  assert.equal(siteBSession?.site_id, siteB, 'new session must belong to the requesting tenant');
  assert.equal(siteBSession?.attribution_source, 'First Click (Paid)', 'new tenant-local session should preserve incoming attribution');
  assert.equal(siteBSession?.gclid, 'SAFECLICK123', 'new tenant-local session should keep the incoming click id');
});
