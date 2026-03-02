/**
 * PR-T1.3 — DB-level ads attribution tightening (traffic_debloat).
 * Case A: referrer google, no gclid → session.attribution_source must NOT be Google Ads.
 * Case B: gclid length < 10 → NOT attributed to Google Ads.
 * Case C: gclid valid length >= 10 → attributed to Google Ads (First Click (Paid)).
 * Requires: STRICT_INGEST_TEST_SITE_ID, Supabase env.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from 'dotenv';
import { join } from 'node:path';
import { adminClient } from '@/lib/supabase/admin';
import { processSyncEvent, getDedupEventIdForJob } from '@/lib/ingest/process-sync-event';
import { getFinalUrl } from '@/lib/types/ingest';

config({ path: join(process.cwd(), '.env.local') });

const TEST_SITE_ID = process.env.STRICT_INGEST_TEST_SITE_ID?.trim();
const HAS_SUPABASE =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

const GOOGLE_ADS_SOURCES = ['First Click (Paid)', 'Ads Assisted'];

function requireEnv() {
  if (!TEST_SITE_ID || !HAS_SUPABASE) {
    return { skip: true, reason: 'STRICT_INGEST_TEST_SITE_ID and Supabase env required' };
  }
  return { skip: false };
}

function job(publicId: string, url: string, referrer: string | null, gclid: string | null, sid: string, msgId: string) {
  const u = gclid ? `${url}${url.includes('?') ? '&' : '?'}gclid=${gclid}` : url;
  return {
    s: publicId,
    url: u,
    ec: 'page',
    ea: 'page_view',
    el: '',
    sid,
    meta: { fp: `fp-attr-${msgId}` },
    ua: 'Mozilla/5.0 (Windows NT 10.0; rv:109.0) Gecko/20100101 Firefox/119.0',
    r: referrer,
    ip: '127.0.0.1',
    consent_scopes: ['analytics'],
  };
}

async function runAndGetAttribution(
  siteIdUuid: string,
  publicId: string,
  referrer: string | null,
  gclid: string | null,
  msgId: string
): Promise<{ attribution_source: string; sessionId: string; sessionMonth: string; dedupEventId: string }> {
  const url = 'https://example.com/attr-test';
  const j = job(publicId, url, referrer, gclid, `sid-${msgId}`, msgId);
  const dedupId = await getDedupEventIdForJob(
    j as import('@/lib/ingest/process-sync-event').WorkerJob,
    getFinalUrl(j as import('@/lib/types/ingest').ValidIngestPayload),
    msgId
  );
  await processSyncEvent(
    j as import('@/lib/ingest/process-sync-event').WorkerJob,
    siteIdUuid,
    msgId
  );
  const { data: ev } = await adminClient
    .from('events')
    .select('session_id, session_month')
    .eq('ingest_dedup_id', dedupId)
    .single();
  assert.ok(ev, 'event must exist');
  const { data: sess } = await adminClient
    .from('sessions')
    .select('attribution_source')
    .eq('id', ev.session_id)
    .eq('created_month', ev.session_month)
    .single();
  assert.ok(sess, 'session must exist');
  return {
    attribution_source: (sess as { attribution_source: string }).attribution_source ?? '',
    sessionId: ev.session_id,
    sessionMonth: ev.session_month,
    dedupEventId: dedupId,
  };
}

test('ads attribution Case A: referrer google, no gclid → NOT Google Ads', async (t) => {
  const env = requireEnv();
  if (env.skip) {
    t.skip(env.reason);
    return;
  }

  const siteIdUuid = TEST_SITE_ID!;
  const { data: siteRow } = await adminClient
    .from('sites')
    .select('id, public_id, config')
    .eq('id', siteIdUuid)
    .single();
  if (!siteRow) {
    t.skip('Test site not found');
    return;
  }

  const originalConfig = (siteRow.config as Record<string, unknown>) || {};
  await adminClient
    .from('sites')
    .update({ config: { ...originalConfig, traffic_debloat: true } })
    .eq('id', siteIdUuid);
  t.after(async () => {
    await adminClient.from('sites').update({ config: originalConfig }).eq('id', siteIdUuid);
  });

  const publicId = (siteRow.public_id as string) || siteIdUuid;
  const result = await runAndGetAttribution(siteIdUuid, publicId, 'https://google.com/', null, 'case-a');
  assert.ok(
    !GOOGLE_ADS_SOURCES.includes(result.attribution_source),
    `Case A: attribution_source must NOT be Google Ads, got: ${result.attribution_source}`
  );

  t.after(async () => {
    await adminClient.from('events').delete().eq('session_id', result.sessionId).eq('session_month', result.sessionMonth);
    await adminClient.from('sessions').delete().eq('id', result.sessionId).eq('created_month', result.sessionMonth);
    await adminClient.from('processed_signals').delete().eq('event_id', result.dedupEventId).eq('site_id', siteIdUuid);
  });
});

test('ads attribution Case B: gclid length < 10 → NOT Google Ads', async (t) => {
  const env = requireEnv();
  if (env.skip) {
    t.skip(env.reason);
    return;
  }

  const siteIdUuid = TEST_SITE_ID!;
  const { data: siteRow } = await adminClient
    .from('sites')
    .select('id, public_id, config')
    .eq('id', siteIdUuid)
    .single();
  if (!siteRow) {
    t.skip('Test site not found');
    return;
  }

  const originalConfig = (siteRow.config as Record<string, unknown>) || {};
  await adminClient
    .from('sites')
    .update({ config: { ...originalConfig, traffic_debloat: true } })
    .eq('id', siteIdUuid);
  t.after(async () => {
    await adminClient.from('sites').update({ config: originalConfig }).eq('id', siteIdUuid);
  });

  const publicId = (siteRow.public_id as string) || siteIdUuid;
  const result = await runAndGetAttribution(siteIdUuid, publicId, null, '123', 'case-b');
  assert.ok(
    !GOOGLE_ADS_SOURCES.includes(result.attribution_source),
    `Case B: gclid length < 10 must NOT be attributed to Google Ads, got: ${result.attribution_source}`
  );

  t.after(async () => {
    await adminClient.from('events').delete().eq('session_id', result.sessionId).eq('session_month', result.sessionMonth);
    await adminClient.from('sessions').delete().eq('id', result.sessionId).eq('created_month', result.sessionMonth);
    await adminClient.from('processed_signals').delete().eq('event_id', result.dedupEventId).eq('site_id', siteIdUuid);
  });
});

test('ads attribution Case C: gclid valid length >= 10 → Google Ads', async (t) => {
  const env = requireEnv();
  if (env.skip) {
    t.skip(env.reason);
    return;
  }

  const siteIdUuid = TEST_SITE_ID!;
  const { data: siteRow } = await adminClient
    .from('sites')
    .select('id, public_id, config')
    .eq('id', siteIdUuid)
    .single();
  if (!siteRow) {
    t.skip('Test site not found');
    return;
  }

  const originalConfig = (siteRow.config as Record<string, unknown>) || {};
  await adminClient
    .from('sites')
    .update({ config: { ...originalConfig, traffic_debloat: true } })
    .eq('id', siteIdUuid);
  t.after(async () => {
    await adminClient.from('sites').update({ config: originalConfig }).eq('id', siteIdUuid);
  });

  const publicId = (siteRow.public_id as string) || siteIdUuid;
  const result = await runAndGetAttribution(siteIdUuid, publicId, null, 'abcdef123456', 'case-c');
  // Stored value for Google Ads (Paid) click is "First Click (Paid)"
  assert.equal(
    result.attribution_source,
    'First Click (Paid)',
    `Case C: valid gclid must be attributed to Google Ads (Paid); got: ${result.attribution_source}`
  );

  t.after(async () => {
    await adminClient.from('events').delete().eq('session_id', result.sessionId).eq('session_month', result.sessionMonth);
    await adminClient.from('sessions').delete().eq('id', result.sessionId).eq('created_month', result.sessionMonth);
    await adminClient.from('processed_signals').delete().eq('event_id', result.dedupEventId).eq('site_id', siteIdUuid);
  });
});
