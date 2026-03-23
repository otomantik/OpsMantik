import { qstash } from '@/lib/qstash/client';

export type IngestLane = 'telemetry' | 'conversion';

export type PublishToQStashOptions = {
  /** Target URL. If omitted, resolved from lane. */
  url?: string;
  /** Ingest lane for automatic URL resolution and tagging. Defaults to telemetry. */
  lane?: IngestLane;
  body: Record<string, unknown>;
  deduplicationId: string;
  retries?: number;
};

/**
 * Resolve target worker URL based on lane.
 * Fast-Lane: /api/workers/ingest/telemetry
 * Value-Lane: /api/workers/ingest/conversion
 */
function resolveLaneUrl(lane: IngestLane): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || '';
  if (lane === 'conversion') return `${base}/api/workers/ingest/conversion`;
  return `${base}/api/workers/ingest/telemetry`;
}

/**
 * Publish a payload to QStash with deduplication and lane routing.
 * Same deduplicationId within 10 minutes => QStash accepts but does not re-enqueue.
 */
export async function publishToQStash(options: PublishToQStashOptions): Promise<void> {
  const { url, lane = 'telemetry', body, deduplicationId, retries = 3 } = options;
  
  const targetUrl = url || resolveLaneUrl(lane);

  await qstash.publishJSON({
    url: targetUrl,
    body,
    deduplicationId,
    retries,
  });
}
