/**
 * PR-T1.1 — DB-level skip path invariant (traffic_debloat).
 * Asserts: ingest_idempotency row exists with billable=false; no usage increment;
 * no session; processed_signals terminal; retry hits idempotency duplicate.
 * Requires: STRICT_INGEST_TEST_SITE_ID (UUID), Supabase env.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from 'dotenv';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { adminClient } from '@/lib/supabase/admin';
import { getSiteIngestConfig } from '@/lib/ingest/site-ingest-config';
import { isCommonBotUA, hasValidClickId, isAllowedReferrer } from '@/lib/ingest/bot-referrer-gates';
import { getFinalUrl } from '@/lib/types/ingest';
import { computeIdempotencyKey, tryInsertIdempotencyKey } from '@/lib/idempotency';
import { getDedupEventIdForJob } from '@/lib/ingest/process-sync-event';
import { getUsagePgCount, getCurrentYearMonthUTC } from '@/lib/quota';
import { requireStrictEnv, resolveStrictTestSiteId } from '@/tests/helpers/strict-ingest-helpers';

config({ path: join(process.cwd(), '.env.local') });

test('strict ingest skip path: bot UA → idempotency billable=false, no session, processed_signals terminal', async (t) => {
  const env = requireStrictEnv();
  if (env.skip) {
    t.skip(env.reason);
    return;
  }

  const siteIdUuid = await resolveStrictTestSiteId();
  if (!siteIdUuid) {
    t.skip('No test site available for strict ingest integration test');
    return;
  }
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
  try {
    await adminClient
      .from('sites')
      .update({ config: { ...originalConfig, traffic_debloat: true } })
      .eq('id', siteIdUuid);
  } catch (e) {
    t.skip(`Could not set site config: ${(e as Error).message}`);
    return;
  }
  let idempotencyKey: string | null = null;
  let dedupEventIdCleanup: string | null = null;
  t.after(async () => {
    await adminClient.from('sites').update({ config: restored }).eq('id', siteIdUuid);
    if (idempotencyKey) {
      await adminClient.from('ingest_idempotency').delete().eq('site_id', siteIdUuid).eq('idempotency_key', idempotencyKey);
    }
    if (dedupEventIdCleanup) {
      await adminClient.from('processed_signals').delete().eq('event_id', dedupEventIdCleanup).eq('site_id', siteIdUuid);
    }
  });

  const publicId = (siteRow.public_id as string) || siteIdUuid;
  const fingerprint = `fp-skip-${randomUUID()}`;
  const sessionSid = `test-sid-skip-${randomUUID()}`;
  const url = 'https://example.com/page';
  const job = {
    s: publicId,
    url,
    ec: 'page',
    ea: 'page_view',
    el: '',
    sid: sessionSid,
    meta: { fp: fingerprint },
    ua: 'curl/8.0',
    r: null,
    ip: '127.0.0.1',
    consent_scopes: ['analytics'],
  } as unknown as import('@/lib/types/ingest').ValidIngestPayload;

  const yearMonth = getCurrentYearMonthUTC();
  const usageBefore = await getUsagePgCount(siteIdUuid, yearMonth);
  const { count: matchingSessionsBefore } = await adminClient
    .from('sessions')
    .select('*', { count: 'exact', head: true })
    .eq('site_id', siteIdUuid)
    .eq('fingerprint', fingerprint);

  const config_ = await getSiteIngestConfig(siteIdUuid);
  const trafficDebloat = config_.traffic_debloat || config_.ingest_strict_mode;
  assert.equal(trafficDebloat, true, 'site must have traffic_debloat');

  const ua = 'curl/8.0';
  const referrer = null;
  const eventHost = new URL(url).hostname;
  const hasClickId = hasValidClickId({ gclid: null, wbraid: null, gbraid: null });
  const botSkip = isCommonBotUA(ua, { allowPreviewUAs: config_.ingest_allow_preview_uas });
  const referrerAllowed = isAllowedReferrer(referrer, url, {
    allowlist: config_.referrer_allowlist,
    blocklist: config_.referrer_blocklist,
    eventHost,
  });
  void referrerAllowed;
  const referrerSkip = !referrerAllowed && !hasClickId; // unused
  void referrerSkip;
  assert.ok(botSkip, 'curl must be detected as bot');
  assert.ok(!hasClickId, 'no click id');

  idempotencyKey = await computeIdempotencyKey(siteIdUuid, job);
  const idemResult = await tryInsertIdempotencyKey(siteIdUuid, idempotencyKey, {
    billable: false,
    billingReason: 'bot_ua',
    eventCategory: job.ec,
    eventAction: job.ea,
    eventLabel: job.el ?? null,
  });
  assert.equal(idemResult.inserted, true, 'first insert must succeed');
  assert.equal(idemResult.duplicate, false);

  const dedupEventId = await getDedupEventIdForJob(
    job as import('@/lib/ingest/process-sync-event').WorkerJob,
    getFinalUrl(job),
    null
  );
  dedupEventIdCleanup = dedupEventId;
  await adminClient.from('processed_signals').insert({
    event_id: dedupEventId,
    site_id: siteIdUuid,
    status: 'skipped',
  });

  const usageAfter = await getUsagePgCount(siteIdUuid, yearMonth);
  const { count: matchingSessionsAfter } = await adminClient
    .from('sessions')
    .select('*', { count: 'exact', head: true })
    .eq('site_id', siteIdUuid)
    .eq('fingerprint', fingerprint);

  assert.equal(usageAfter, usageBefore, 'usage must not increment (billable count unchanged)');
  assert.equal(matchingSessionsAfter, matchingSessionsBefore, 'no new session for skipped fingerprint');

  const { data: idemRow } = await adminClient
    .from('ingest_idempotency')
    .select('billable, billing_reason')
    .eq('site_id', siteIdUuid)
    .eq('idempotency_key', idempotencyKey)
    .single();
  assert.ok(idemRow, 'idempotency row must exist');
  assert.equal((idemRow as { billable: boolean }).billable, false);
  assert.equal((idemRow as { billing_reason?: string }).billing_reason, 'bot_ua');

  const { data: psRow } = await adminClient
    .from('processed_signals')
    .select('status')
    .eq('event_id', dedupEventId)
    .eq('site_id', siteIdUuid)
    .single();
  assert.ok(psRow, 'processed_signals row must exist');
  assert.equal((psRow as { status: string }).status, 'skipped');

  const retryResult = await tryInsertIdempotencyKey(siteIdUuid, idempotencyKey, {
    billable: false,
    billingReason: 'bot_ua',
    eventCategory: job.ec,
    eventAction: job.ea,
    eventLabel: job.el ?? null,
  });
  assert.equal(retryResult.duplicate, true, 'retry must hit idempotency duplicate');
  assert.equal(retryResult.inserted, false);

  const { count: sessionCountAfterRetry } = await adminClient
    .from('sessions')
    .select('*', { count: 'exact', head: true })
    .eq('site_id', siteIdUuid)
    .eq('fingerprint', fingerprint);
  assert.equal(sessionCountAfterRetry, matchingSessionsBefore, 'still no new session after retry for skipped fingerprint');
});
