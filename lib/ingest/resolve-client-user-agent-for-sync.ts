import type { NextRequest } from 'next/server';
import { normalizeUserAgent, type ValidIngestPayload } from '@/lib/types/ingest';

/**
 * Prefer the browser UA when a same-site proxy (e.g. Cloudflare worker) forwards it,
 * then tracker body `ua`, then the immediate HTTP User-Agent (correct for direct hits).
 */
export function resolveClientUserAgentForSync(req: NextRequest, event: ValidIngestPayload): string {
  const forwarded = req.headers.get('x-ops-client-user-agent')?.trim();
  if (forwarded) return normalizeUserAgent(forwarded);
  const raw = (event as Record<string, unknown>).ua;
  if (typeof raw === 'string' && raw.trim()) return normalizeUserAgent(raw);
  return normalizeUserAgent(req.headers.get('user-agent'));
}
