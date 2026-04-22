import { requireQstashSignature } from '@/lib/qstash/require-signature';
import { executeIngest } from '@/lib/ingest/execute-ingest-command';

export const runtime = 'nodejs';

/**
 * Fast-Lane Ingest (Telemetry)
 * High concurrence, low priority.
 */
export const POST = requireQstashSignature((req) => executeIngest(req, 'telemetry'));
