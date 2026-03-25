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
 * Public origin for worker callbacks (QStash must receive an absolute https URL).
 * Prefer NEXT_PUBLIC_APP_URL in Vercel (e.g. https://console.opsmantik.com).
 * If unset, Vercel injects VERCEL_URL — use it so deploys do not enqueue to a relative path (QStash rejects / breaks).
 */
export function resolveAppBaseUrlForIngest(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, '');
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) {
    const host = vercel.replace(/^https?:\/\//, '');
    return `https://${host}`;
  }
  return '';
}

/**
 * Resolve target worker URL based on lane.
 * Fast-Lane: /api/workers/ingest/telemetry
 * Value-Lane: /api/workers/ingest/conversion
 */
function resolveLaneUrl(lane: IngestLane): string {
  const base = resolveAppBaseUrlForIngest();
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

  if (!/^https?:\/\//i.test(targetUrl)) {
    throw new Error(
      `Ingest worker URL must be absolute (https://...). Set NEXT_PUBLIC_APP_URL on the server, or use Vercel (VERCEL_URL). Got: ${targetUrl.slice(0, 120)}`
    );
  }

  await qstash.publishJSON({
    url: targetUrl,
    body,
    deduplicationId,
    retries,
  });
}
