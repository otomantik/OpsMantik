import { requireQstashSignature } from '@/lib/qstash/require-signature';
import { executeIngest } from '@/lib/ingest/worker-kernel';

export const runtime = 'nodejs';

/**
 * Value-Lane Ingest (Conversion)
 * Critical priority (VIP).
 */
export const POST = requireQstashSignature((req) => executeIngest(req, 'conversion'));
