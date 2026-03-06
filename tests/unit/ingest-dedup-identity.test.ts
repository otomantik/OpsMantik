import test from 'node:test';
import assert from 'node:assert/strict';
import { getDedupEventIdForJob, type WorkerJob } from '@/lib/ingest/process-sync-event';

function buildJob(overrides: Partial<WorkerJob> = {}): WorkerJob {
  return {
    s: 'site-public-id',
    sid: 'session-123',
    sm: '2026-03-01',
    ec: 'page',
    ea: 'page_view',
    el: 'Landing',
    ev: 1,
    url: 'https://example.com/landing',
    r: 'https://google.com/',
    meta: { fp: 'fp-123', gclid: 'GCLID-1234567890' },
    ...overrides,
  };
}

test('dedup identity prefers qstash message id when present', async () => {
  const jobA = buildJob({ ingest_id: 'ingest-a' });
  const jobB = buildJob({ ingest_id: 'ingest-b' });

  const dedupA = await getDedupEventIdForJob(jobA, 'https://example.com/landing', 'msg-1');
  const dedupB = await getDedupEventIdForJob(jobB, 'https://example.com/landing', 'msg-1');

  assert.equal(dedupA, dedupB, 'qstash message id must dominate dedup identity');
});

test('dedup identity uses ingest_id for non-qstash worker paths', async () => {
  const base = buildJob();
  const dedupA = await getDedupEventIdForJob({ ...base, ingest_id: 'ingest-a' }, 'https://example.com/landing', null);
  const dedupB = await getDedupEventIdForJob({ ...base, ingest_id: 'ingest-b' }, 'https://example.com/landing', null);
  const dedupAReplay = await getDedupEventIdForJob({ ...base, ingest_id: 'ingest-a' }, 'https://example.com/landing', null);

  assert.notEqual(dedupA, dedupB, 'different ingest_id values must not collapse into one dedup event id');
  assert.equal(dedupA, dedupAReplay, 'same ingest_id replay must stay deduplicable');
});

test('dedup identity falls back to om_trace_uuid before payload fingerprint', async () => {
  const base = buildJob({ ingest_id: undefined, om_trace_uuid: 'trace-123' });
  const dedupA = await getDedupEventIdForJob(base, 'https://example.com/landing', null);
  const dedupB = await getDedupEventIdForJob({ ...base, ea: 'click', el: 'Different event' }, 'https://example.com/landing', null);

  assert.equal(dedupA, dedupB, 'same trace id replay should dedup even if non-identity fields vary');
});

test('dedup identity payload fallback distinguishes separate events without ingest_id', async () => {
  const base = buildJob({ ingest_id: undefined, om_trace_uuid: undefined });
  const dedupA = await getDedupEventIdForJob(base, 'https://example.com/landing', null);
  const dedupB = await getDedupEventIdForJob({ ...base, el: 'Landing-2' }, 'https://example.com/landing', null);

  assert.notEqual(dedupA, dedupB, 'payload fallback must separate distinct events when no stable ids exist');
});
