/**
 * Publish to QStash with deduplication for async ingest (202 Accepted) architecture.
 * Uses Upstash-Deduplication-Id to prevent double-queuing on client retries.
 */

import { qstash } from '@/lib/qstash/client';

export type PublishToQStashOptions = {
  url: string;
  body: Record<string, unknown>;
  deduplicationId: string;
  retries?: number;
};

/**
 * Publish a payload to QStash with deduplication.
 * Same deduplicationId within 10 minutes => QStash accepts but does not re-enqueue.
 */
export async function publishToQStash(options: PublishToQStashOptions): Promise<void> {
  const { url, body, deduplicationId, retries = 3 } = options;
  await qstash.publishJSON({
    url,
    body,
    deduplicationId,
    retries,
  });
}
