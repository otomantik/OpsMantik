/**
 * PR-T1.2 — DB-level page_view 10s session reuse.
 * Same fingerprint + same normalized URL within 10s → one session, two events.
 * Different URL or different fingerprint → new session.
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

function requireEnv() {
  if (!TEST_SITE_ID || !HAS_SUPABASE) {
    return { skip: true, reason: 'STRICT_INGEST_TEST_SITE_ID and Supabase env required' };
  }
  return { skip: false };
}

function baseJob(publicId: string, url: string, fingerprint: string, sid: string) {
  return {
    s: publicId,
    url,
    ec: 'page',
    ea: 'page_view',
    el: '',
    sid,
    meta: { fp: fingerprint },
    ua: 'Mozilla/5.0 (Windows NT 10.0; rv:109.0) Gecko/20100101 Firefox/119.0',
    r: null,
    ip: '127.0.0.1',
    consent_scopes: ['analytics'],
  };
}

test('pageview 10s reuse: same fingerprint + same URL → one session, two events', async (t) => {
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
  const restored = { ...originalConfig };
  await adminClient
    .from('sites')
    .update({ config: { ...originalConfig, page_view_10s_session_reuse: true } })
    .eq('id', siteIdUuid);
  t.after(async () => {
    await adminClient.from('sites').update({ config: restored }).eq('id', siteIdUuid);
  });

  const publicId = (siteRow.public_id as string) || siteIdUuid;
  const url = 'https://example.com/landing';
  const fingerprint = 'fp-10s-reuse-same';
  const job1 = baseJob(publicId, url, fingerprint, 'sid-pv-1');
  const job2 = baseJob(publicId, url, fingerprint, 'sid-pv-2');

  const msg1 = 'pv-reuse-msg-1';
  const msg2 = 'pv-reuse-msg-2';
  const dedupId1 = await getDedupEventIdForJob(
    job1 as import('@/lib/ingest/process-sync-event').WorkerJob,
    getFinalUrl(job1 as import('@/lib/types/ingest').ValidIngestPayload),
    msg1
  );
  const dedupId2 = await getDedupEventIdForJob(
    job2 as import('@/lib/ingest/process-sync-event').WorkerJob,
    getFinalUrl(job2 as import('@/lib/types/ingest').ValidIngestPayload),
    msg2
  );

  let sessionId: string | null = null;
  let sessionMonth: string | null = null;
  t.after(async () => {
    if (sessionId && sessionMonth) {
      await adminClient.from('events').delete().eq('session_id', sessionId).eq('session_month', sessionMonth);
      await adminClient.from('sessions').delete().eq('id', sessionId).eq('created_month', sessionMonth);
    }
    await adminClient.from('processed_signals').delete().eq('site_id', siteIdUuid).in('event_id', [dedupId1, dedupId2]);
  });

  await processSyncEvent(
    job1 as import('@/lib/ingest/process-sync-event').WorkerJob,
    siteIdUuid,
    msg1
  );

  const { data: sessionsAfter1 } = await adminClient
    .from('sessions')
    .select('id, created_month')
    .eq('site_id', siteIdUuid)
    .eq('fingerprint', fingerprint);
  assert.ok(sessionsAfter1?.length === 1, 'one session after first event');
  sessionId = sessionsAfter1![0].id;
  sessionMonth = sessionsAfter1![0].created_month;

  const { data: sessionRow1 } = await adminClient
    .from('sessions')
    .select('id, created_at, updated_at')
    .eq('id', sessionId!)
    .eq('created_month', sessionMonth!)
    .single();
  const updatedAt1 = (sessionRow1 as { updated_at?: string })?.updated_at ?? (sessionRow1 as { created_at?: string })?.created_at;

  await processSyncEvent(
    job2 as import('@/lib/ingest/process-sync-event').WorkerJob,
    siteIdUuid,
    msg2
  );

  const { count: sessionCount } = await adminClient
    .from('sessions')
    .select('*', { count: 'exact', head: true })
    .eq('site_id', siteIdUuid)
    .eq('fingerprint', fingerprint);
  assert.equal(sessionCount, 1, 'still one session after second event');

  const { count: eventCount } = await adminClient
    .from('events')
    .select('*', { count: 'exact', head: true })
    .eq('session_id', sessionId!)
    .eq('session_month', sessionMonth!);
  assert.equal(eventCount, 2, 'two events linked to same session');

  const { data: sessionRow2 } = await adminClient
    .from('sessions')
    .select('updated_at, created_at')
    .eq('id', sessionId!)
    .eq('created_month', sessionMonth!)
    .single();
  const updatedAt2 = (sessionRow2 as { updated_at?: string })?.updated_at ?? (sessionRow2 as { created_at?: string })?.created_at;
  if (updatedAt1 != null && updatedAt2 != null && (sessionRow2 as { updated_at?: string }).updated_at != null) {
    assert.ok(new Date(updatedAt2).getTime() >= new Date(updatedAt1).getTime(), 'session.updated_at increased after second event');
  }
});

test('pageview 10s reuse: different URL → new session', async (t) => {
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
    .update({ config: { ...originalConfig, page_view_10s_session_reuse: true } })
    .eq('id', siteIdUuid);
  t.after(async () => {
    await adminClient.from('sites').update({ config: originalConfig }).eq('id', siteIdUuid);
  });

  const publicId = (siteRow.public_id as string) || siteIdUuid;
  const fingerprint = 'fp-10s-reuse-diff-url';
  const job1 = baseJob(publicId, 'https://example.com/page-a', fingerprint, 'sid-diff-1');
  const job2 = baseJob(publicId, 'https://example.com/page-b', fingerprint, 'sid-diff-2');
  const msg1 = 'pv-diff-url-1';
  const msg2 = 'pv-diff-url-2';
  const dedupId1 = await getDedupEventIdForJob(job1 as import('@/lib/ingest/process-sync-event').WorkerJob, getFinalUrl(job1 as import('@/lib/types/ingest').ValidIngestPayload), msg1);
  const dedupId2 = await getDedupEventIdForJob(job2 as import('@/lib/ingest/process-sync-event').WorkerJob, getFinalUrl(job2 as import('@/lib/types/ingest').ValidIngestPayload), msg2);

  const sessionIds: string[] = [];
  const sessionMonths: string[] = [];
  t.after(async () => {
    for (let i = 0; i < sessionIds.length; i++) {
      await adminClient.from('events').delete().eq('session_id', sessionIds[i]).eq('session_month', sessionMonths[i]);
      await adminClient.from('sessions').delete().eq('id', sessionIds[i]).eq('created_month', sessionMonths[i]);
    }
    await adminClient.from('processed_signals').delete().eq('site_id', siteIdUuid).in('event_id', [dedupId1, dedupId2]);
  });

  await processSyncEvent(job1 as import('@/lib/ingest/process-sync-event').WorkerJob, siteIdUuid, msg1);
  const { data: list1 } = await adminClient.from('sessions').select('id, created_month').eq('site_id', siteIdUuid).eq('fingerprint', fingerprint);
  list1?.forEach((r) => { sessionIds.push(r.id); sessionMonths.push(r.created_month); });

  await processSyncEvent(job2 as import('@/lib/ingest/process-sync-event').WorkerJob, siteIdUuid, msg2);
  const { data: list2 } = await adminClient.from('sessions').select('id, created_month').eq('site_id', siteIdUuid).eq('fingerprint', fingerprint);
  list2?.forEach((r) => {
    if (!sessionIds.includes(r.id)) { sessionIds.push(r.id); sessionMonths.push(r.created_month); }
  });

  const { count: sessionCount } = await adminClient
    .from('sessions')
    .select('*', { count: 'exact', head: true })
    .eq('site_id', siteIdUuid)
    .eq('fingerprint', fingerprint);
  assert.equal(sessionCount, 2, 'different URL → two sessions');
});

test('pageview 10s reuse: different fingerprint → new session', async (t) => {
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
    .update({ config: { ...originalConfig, page_view_10s_session_reuse: true } })
    .eq('id', siteIdUuid);
  t.after(async () => {
    await adminClient.from('sites').update({ config: originalConfig }).eq('id', siteIdUuid);
  });

  const publicId = (siteRow.public_id as string) || siteIdUuid;
  const url = 'https://example.com/same-page';
  const job1 = baseJob(publicId, url, 'fp-diff-a', 'sid-fp-1');
  const job2 = baseJob(publicId, url, 'fp-diff-b', 'sid-fp-2');
  const msg1 = 'pv-diff-fp-1';
  const msg2 = 'pv-diff-fp-2';
  const dedupId1 = await getDedupEventIdForJob(job1 as import('@/lib/ingest/process-sync-event').WorkerJob, getFinalUrl(job1 as import('@/lib/types/ingest').ValidIngestPayload), msg1);
  const dedupId2 = await getDedupEventIdForJob(job2 as import('@/lib/ingest/process-sync-event').WorkerJob, getFinalUrl(job2 as import('@/lib/types/ingest').ValidIngestPayload), msg2);

  const sessionIds: string[] = [];
  const sessionMonths: string[] = [];
  t.after(async () => {
    for (let i = 0; i < sessionIds.length; i++) {
      await adminClient.from('events').delete().eq('session_id', sessionIds[i]).eq('session_month', sessionMonths[i]);
      await adminClient.from('sessions').delete().eq('id', sessionIds[i]).eq('created_month', sessionMonths[i]);
    }
    await adminClient.from('processed_signals').delete().eq('site_id', siteIdUuid).in('event_id', [dedupId1, dedupId2]);
  });

  await processSyncEvent(job1 as import('@/lib/ingest/process-sync-event').WorkerJob, siteIdUuid, msg1);
  const { data: list1 } = await adminClient.from('sessions').select('id, created_month').eq('site_id', siteIdUuid).in('fingerprint', ['fp-diff-a', 'fp-diff-b']);
  list1?.forEach((r) => { sessionIds.push(r.id); sessionMonths.push(r.created_month); });

  await processSyncEvent(job2 as import('@/lib/ingest/process-sync-event').WorkerJob, siteIdUuid, msg2);
  const { data: list2 } = await adminClient.from('sessions').select('id, created_month').eq('site_id', siteIdUuid).in('fingerprint', ['fp-diff-a', 'fp-diff-b']);
  list2?.forEach((r) => {
    if (!sessionIds.includes(r.id)) { sessionIds.push(r.id); sessionMonths.push(r.created_month); }
  });

  const { count: sessionCount } = await adminClient
    .from('sessions')
    .select('*', { count: 'exact', head: true })
    .eq('site_id', siteIdUuid)
    .in('fingerprint', ['fp-diff-a', 'fp-diff-b']);
  assert.equal(sessionCount, 2, 'different fingerprint → two sessions');
});
